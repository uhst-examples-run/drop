/**
 * @jest-environment jsdom
 */
import { FileSender, FileReceiver } from '../src/transfer.js';
import { EventEmitter } from 'events';

class MockUHST extends EventEmitter {
    constructor() {
        super();
        this.readyState = 'open';
    }
    send(message) {
        this.emit('sent', message);
    }
    close() {
        this.readyState = 'closed';
        this.emit('close');
    }
}

// Mock FileReader
if (typeof FileReader === 'undefined') {
    global.FileReader = class {
        readAsArrayBuffer(blob) {
            this.result = blob.buffer || new ArrayBuffer(blob.size);
            setTimeout(() => this.onload(), 0);
        }
    };
}

// Mock Blob if needed (jsdom should have it)
if (typeof Blob === 'undefined') {
    global.Blob = class {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
            this.size = parts.reduce((acc, part) => acc + (part.byteLength || part.size || 0), 0);
        }
        slice(start, end) {
            return new Blob([]); // Simplified
        }
    };
}

describe('File Transfer', () => {
    let client, file, sender, receiver;

    beforeEach(() => {
        client = new MockUHST();
        file = new Blob([new Uint8Array(100)], { type: 'text/plain' });
        receiver = new FileReceiver();
    });

    test('FileSender sends metadata and chunks', async () => {
        const sentMessages = [];
        client.on('sent', (msg) => {
            const parsed = JSON.parse(msg);
            sentMessages.push(parsed);
            // Simulate host ACK
            setTimeout(() => {
                client.emit('message', JSON.stringify({
                    type: 'file-ack',
                    fileId: parsed.fileId,
                    chunkIndex: parsed.type === 'file-metadata' ? -1 : parsed.chunkIndex
                }));
            }, 10);
        });

        sender = new FileSender(client, file, { chunkSize: 50 });
        await sender.send();

        expect(sentMessages.length).toBe(3); // Metadata + 2 chunks
        expect(sentMessages[0].type).toBe('file-metadata');
        expect(sentMessages[1].type).toBe('file-chunk');
        expect(sentMessages[1].chunkIndex).toBe(0);
        expect(sentMessages[2].chunkIndex).toBe(1);
    });

    test('FileSender retries on timeout', async () => {
        const sentMessages = [];
        let metadataAckSent = false;
        
        client.on('sent', (msg) => {
            const parsed = JSON.parse(msg);
            sentMessages.push(parsed);
            
            // Only ACK the second time for metadata to test retry
            if (parsed.type === 'file-metadata') {
                if (metadataAckSent) {
                    setTimeout(() => {
                        client.emit('message', JSON.stringify({
                            type: 'file-ack',
                            fileId: parsed.fileId,
                            chunkIndex: -1
                        }));
                    }, 10);
                } else {
                    metadataAckSent = true;
                    // Don't send ACK first time, let it timeout
                }
            } else {
                setTimeout(() => {
                    client.emit('message', JSON.stringify({
                        type: 'file-ack',
                        fileId: parsed.fileId,
                        chunkIndex: parsed.chunkIndex
                    }));
                }, 10);
            }
        });

        sender = new FileSender(client, file, { 
            chunkSize: 100, 
            maxRetries: 1,
            ackTimeout: 100 // Short timeout for test
        });
        
        await sender.send();

        // Metadata should be sent twice because of one timeout
        expect(sentMessages.filter(m => m.type === 'file-metadata').length).toBe(2);
        expect(sentMessages.length).toBe(3); // 2 metadata + 1 chunk
    });

    test('FileSender fails after max retries', async () => {
        sender = new FileSender(client, file, { 
            chunkSize: 100, 
            maxRetries: 1,
            ackTimeout: 100
        });
        
        // No ACKs sent at all
        await expect(sender.send()).rejects.toThrow('Failed to send chunk metadata after 1 retries');
    });

    test('FileReceiver reconstructs file', (done) => {
        receiver.onFileReceived = (blob, fileName) => {
            expect(fileName).toBe('test.txt');
            expect(blob.size).toBe(100);
            done();
        };

        const ws = {
            send: jest.fn()
        };

        const fileId = 'abc';
        receiver.handleMessage(ws, JSON.stringify({
            type: 'file-metadata',
            fileId,
            fileName: 'test.txt',
            fileType: 'text/plain',
            fileSize: 100,
            totalChunks: 2
        }));

        receiver.handleMessage(ws, JSON.stringify({
            type: 'file-chunk',
            fileId,
            chunkIndex: 0,
            chunkData: Array.from(new Uint8Array(50))
        }));

        receiver.handleMessage(ws, JSON.stringify({
            type: 'file-chunk',
            fileId,
            chunkIndex: 1,
            chunkData: Array.from(new Uint8Array(50))
        }));
        
        expect(ws.send).toHaveBeenCalledTimes(3); // metadata ack + 2 chunks ack
    });
});
