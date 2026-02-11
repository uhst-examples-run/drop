export class FileSender {
    constructor(client, file, options = {}) {
        this.client = client;
        this.file = file;
        this.chunkSize = options.chunkSize || 16 * 1024;
        this.maxRetries = options.maxRetries || 5;
        this.ackTimeout = options.ackTimeout || 10000;
        
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
        this.onStatus = options.onStatus || (() => {});
        
        this.fileId = Math.random().toString(36).substring(2);
        this.totalChunks = Math.ceil(file.size / this.chunkSize);
        this.chunkIndex = 0;
        this.sentBytes = 0;
        this.startTime = null;
        
        this.ackHandlers = new Map();
        
        this._messageHandler = (message) => {
            try {
                const msg = JSON.parse(message);
                if (msg.type === 'file-ack' && msg.fileId === this.fileId) {
                    const handler = this.ackHandlers.get(msg.chunkIndex);
                    if (handler) {
                        handler();
                        this.ackHandlers.delete(msg.chunkIndex);
                    }
                }
            } catch (e) {
                // Ignore non-JSON or other messages
            }
        };
        
        this.client.on('message', this._messageHandler);
    }

    async send() {
        try {
            this.startTime = Date.now();
            this.onStatus('Connected to host.');

            // Send file metadata
            const metadataMessage = {
                type: 'file-metadata',
                fileId: this.fileId,
                fileName: this.file.name,
                fileType: this.file.type,
                fileSize: this.file.size,
                totalChunks: this.totalChunks
            };
            
            await this.sendMessageWithRetry(metadataMessage, -1);

            while (this.chunkIndex < this.totalChunks) {
                await this.sendChunkWithRetry(this.chunkIndex);
                this.chunkIndex++;
            }
            
            this.onStatus('File sent successfully.');
            this.onComplete();
        } catch (error) {
            this.onError(error);
            throw error;
        } finally {
            // We might want to keep the handler if multiple files are sent, 
            // but for this example we can probably clean up if it's one-shot.
            // However, client.off is not always available in all emitters.
            if (typeof this.client.off === 'function') {
                this.client.off('message', this._messageHandler);
            }
        }
    }

    async sendChunkWithRetry(index) {
        const offset = index * this.chunkSize;
        const blob = this.file.slice(offset, offset + this.chunkSize);
        const chunkData = await this.readBlobAsArrayBuffer(blob);
        const uint8Array = new Uint8Array(chunkData);
        const chunkArray = Array.from(uint8Array);

        const chunkMessage = {
            type: 'file-chunk',
            fileId: this.fileId,
            chunkIndex: index,
            chunkData: chunkArray
        };

        await this.sendMessageWithRetry(chunkMessage, index);
        
        this.sentBytes += chunkData.byteLength;
        this.onProgress({
            sentBytes: this.sentBytes,
            totalBytes: this.file.size,
            chunkIndex: index,
            totalChunks: this.totalChunks,
            startTime: this.startTime
        });
    }

    async sendMessageWithRetry(message, ackIndex) {
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.onStatus(`Retrying chunk ${ackIndex === -1 ? 'metadata' : ackIndex + 1}... (attempt ${attempt}/${this.maxRetries})`);
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 10000)));
                }
                
                const ackPromise = this.waitForAck(ackIndex);
                
                this.client.send(JSON.stringify(message));
                
                // Wait for ACK with timeout
                await Promise.race([
                    ackPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('ACK timeout')), this.ackTimeout))
                ]);
                
                return; // Success
            } catch (error) {
                lastError = error;
                this.onStatus(`Chunk ${ackIndex === -1 ? 'metadata' : ackIndex + 1} failed: ${error.message}`);
                // If the client is closed, don't bother retrying
                if (this.client.readyState === 'closed') {
                    throw new Error('Connection closed');
                }
            }
        }
        throw new Error(`Failed to send chunk ${ackIndex === -1 ? 'metadata' : ackIndex + 1} after ${this.maxRetries} retries: ${lastError.message}`);
    }

    waitForAck(index) {
        return new Promise(resolve => {
            this.ackHandlers.set(index, resolve);
        });
    }

    readBlobAsArrayBuffer(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
        });
    }
}

export class FileReceiver {
    constructor(options = {}) {
        this.onProgress = options.onProgress || (() => {});
        this.onFileReceived = options.onFileReceived || (() => {});
        this.onStatus = options.onStatus || (() => {});
        
        this.receivedChunks = {};
        this.totalChunks = {};
        this.fileMetadata = {};
        this.receivedChunkCount = {};
        this.startTime = {};
        this.receivedBytes = {};
    }

    handleMessage(ws, messageStr) {
        let message;
        try {
            message = JSON.parse(messageStr);
        } catch (e) {
            return;
        }
        
        const fileId = message.fileId;
        if (!fileId) return;

        if (message.type === 'file-metadata') {
            this.startTime[fileId] = Date.now();
            this.receivedChunks[fileId] = [];
            this.totalChunks[fileId] = message.totalChunks;
            this.fileMetadata[fileId] = message;
            this.receivedChunkCount[fileId] = 0;
            this.receivedBytes[fileId] = 0;
            this.onStatus(`Receiving file ${message.fileName} (${message.totalChunks} chunks)`);
            
            // Ack metadata
            ws.send(JSON.stringify({ type: 'file-ack', fileId, chunkIndex: -1 }));
        } else if (message.type === 'file-chunk') {
            const chunkIndex = message.chunkIndex;
            
            if (this.receivedChunks[fileId] && !this.receivedChunks[fileId][chunkIndex]) {
                const chunkArray = message.chunkData;
                const uint8Array = new Uint8Array(chunkArray);
                this.receivedChunks[fileId][chunkIndex] = uint8Array;
                this.receivedChunkCount[fileId]++;
                this.receivedBytes[fileId] += uint8Array.length;
                
                this.onStatus(`Received chunk ${chunkIndex + 1}/${this.totalChunks[fileId]}`);
                
                this.onProgress({
                    fileId,
                    receivedBytes: this.receivedBytes[fileId],
                    totalBytes: this.fileMetadata[fileId].fileSize,
                    receivedChunkCount: this.receivedChunkCount[fileId],
                    totalChunks: this.totalChunks[fileId],
                    startTime: this.startTime[fileId]
                });
            }

            // Always ACK the chunk if we have the fileId initialized
            if (this.receivedChunks[fileId]) {
                ws.send(JSON.stringify({ type: 'file-ack', fileId, chunkIndex }));

                if (this.receivedChunkCount[fileId] === this.totalChunks[fileId]) {
                    this.reconstructFile(fileId);
                }
            }
        }
    }

    reconstructFile(fileId) {
        const metadata = this.fileMetadata[fileId];
        const chunks = this.receivedChunks[fileId];
        const total = this.totalChunks[fileId];

        // Ensure all chunks are present
        for (let i = 0; i < total; i++) {
            if (!chunks[i]) {
                return;
            }
        }

        const blob = new Blob(chunks, { type: metadata.fileType });
        this.onFileReceived(blob, metadata.fileName);
        this.onStatus(`File ${metadata.fileName} received and ready to download.`);
        
        delete this.receivedChunks[fileId];
        delete this.totalChunks[fileId];
        delete this.fileMetadata[fileId];
        delete this.receivedChunkCount[fileId];
        delete this.startTime[fileId];
        delete this.receivedBytes[fileId];
    }
}
