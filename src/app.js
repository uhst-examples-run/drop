import { FileSender, FileReceiver } from './transfer.js';
import { formatBytes, formatTime } from './utils.js';

let hostStatusEl, clientStatusEl, hostIdEl, qrcodeEl, appLinkEl, copyButtonEl;
let uhstApi;

function appendHostStatus(text) {
    if (hostStatusEl) {
        hostStatusEl.value += text + "\n";
        hostStatusEl.scrollTop = hostStatusEl.scrollHeight;
    }
}

function appendClientStatus(text) {
    if (clientStatusEl) {
        clientStatusEl.value += text + "\n";
        clientStatusEl.scrollTop = clientStatusEl.scrollHeight;
    }
}

function getParameterByName(name, url = window.location.href) {
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export function init() {
    hostStatusEl = document.getElementById("hostStatus");
    clientStatusEl = document.getElementById("clientStatus");
    hostIdEl = document.getElementById("hostId");
    qrcodeEl = document.getElementById("qrcode");
    appLinkEl = document.getElementById("appLink");
    copyButtonEl = document.getElementById("copyButton");

    uhstApi = new uhst.UHST({
        debug: true
    });

    const hostIdFromUrl = getParameterByName('hostId');

    if (hostIdFromUrl) {
        setupClient(hostIdFromUrl);
    } else {
        setupHost();
    }
}

function setupHost() {
    document.getElementById('hostSection').style.display = 'block';
    document.getElementById('clientSection').style.display = 'none';

    const host = uhstApi.host();
    appendHostStatus("Initializing Host...");
    
    host.on("ready", () => {
        appendHostStatus("Ready.");
        hostIdEl.innerText = host.hostId;

        const appUrl = window.location.href.split('?')[0];
        const qrUrl = appUrl + '?hostId=' + host.hostId;

        appLinkEl.href = qrUrl;
        appLinkEl.innerText = qrUrl;

        new QRCode(qrcodeEl, {
            text: qrUrl,
            width: 256,
            height: 256
        });

        copyButtonEl.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(qrUrl).then(() => {
                    alert('URL copied to clipboard!');
                }, (err) => {
                    alert('Failed to copy URL: ' + err);
                });
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = qrUrl;
                textArea.style.position = 'fixed';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    const successful = document.execCommand('copy');
                    if (successful) alert('URL copied to clipboard!');
                    else alert('Failed to copy URL using fallback method.');
                } catch (err) {
                    alert('Failed to copy URL: ' + err);
                }
                document.body.removeChild(textArea);
            }
        });
    });

    const receiver = new FileReceiver({
        onStatus: appendHostStatus,
        onProgress: (stats) => {
            const progressBar = document.querySelector('#hostTransferProgress .progress-bar');
            const statsDiv = document.querySelector('#hostTransferProgress .transfer-stats');
            document.getElementById('hostTransferProgress').style.display = 'block';

            const progress = (stats.receivedChunkCount) / stats.totalChunks * 100;
            const elapsedTime = (Date.now() - stats.startTime) / 1000;
            const speed = stats.receivedBytes / elapsedTime;
            const remainingBytes = stats.totalBytes - stats.receivedBytes;
            const estimatedTimeRemaining = remainingBytes / speed;

            progressBar.style.width = `${progress}%`;
            statsDiv.innerHTML = `
                Received: ${formatBytes(stats.receivedBytes)} / ${formatBytes(stats.totalBytes)}<br>
                Speed: ${formatBytes(speed)}/s<br>
                Elapsed: ${formatTime(elapsedTime)}<br>
                Remaining: ${formatTime(estimatedTimeRemaining)}
            `;
        },
        onFileReceived: (blob, fileName) => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });

    host.on("connection", (ws) => {
        appendHostStatus("Host received client connection.");
        ws.on("open", () => {
            appendHostStatus("Host ready to receive file.");
        });
        ws.on("message", (message) => {
            receiver.handleMessage(ws, message);
        });
    });
}

function setupClient(hostId) {
    document.getElementById('hostSection').style.display = 'none';
    document.getElementById('clientSection').style.display = 'block';
    appendClientStatus('Ready to send file to host ' + hostId);

    window.sendFile = async () => {
        const fileInput = document.getElementById('fileInput');
        if (fileInput.files.length === 0) {
            alert('Please select a file to send');
            return;
        }
        const file = fileInput.files[0];
        
        appendClientStatus('Connecting to host ' + hostId + '...');
        const client = uhstApi.join(hostId);

        client.on('open', async () => {
            const sender = new FileSender(client, file, {
                onStatus: appendClientStatus,
                onProgress: (stats) => {
                    const progressBar = document.querySelector('#clientTransferProgress .progress-bar');
                    const statsDiv = document.querySelector('#clientTransferProgress .transfer-stats');
                    document.getElementById('clientTransferProgress').style.display = 'block';

                    const progress = (stats.chunkIndex + 1) / stats.totalChunks * 100;
                    const elapsedTime = (Date.now() - stats.startTime) / 1000;
                    const speed = stats.sentBytes / elapsedTime;
                    const remainingBytes = stats.totalBytes - stats.sentBytes;
                    const estimatedTimeRemaining = remainingBytes / speed;

                    progressBar.style.width = `${progress}%`;
                    statsDiv.innerHTML = `
                        Sent: ${formatBytes(stats.sentBytes)} / ${formatBytes(stats.totalBytes)}<br>
                        Speed: ${formatBytes(speed)}/s<br>
                        Elapsed: ${formatTime(elapsedTime)}<br>
                        Remaining: ${formatTime(estimatedTimeRemaining)}
                    `;
                },
                onComplete: () => {
                    // Give some time for UI to update
                    setTimeout(() => client.close(), 1000);
                },
                onError: (err) => {
                    appendClientStatus('Error: ' + err.message);
                }
            });

            await sender.send();
        });

        client.on('error', (error) => {
            appendClientStatus('Error: ' + error);
        });
    };
}
