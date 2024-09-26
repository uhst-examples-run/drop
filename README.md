# UHST File Transfer with Chunking

This example demonstrates how to create a UHST (User Hosted Secure Transmission) host, join a UHST host, send files in chunks, receive files, and disconnect. It uses plain old JavaScript for simplicity.

You can see the example in action here: [UHST File Transfer Example](https://examples.run/drop/).

## Overview

The application allows users to:

- **Host Side**:
  - Create a UHST host.
  - Generate a QR code and a sharable link containing the `hostId`.
  - Receive files sent by clients.
  - Download received files.

- **Client Side**:
  - Join a UHST host using the `hostId`.
  - Select a file to send to the host.
  - Send the file in chunks to handle larger files and avoid message size limitations.
  - Disconnect after the file is sent.

## Features Demonstrated

- **Creating a UHST Host**: Establishes a host that can accept connections from clients.
- **Joining a UHST Host**: Clients connect to the host using the provided `hostId`.
- **Sending Messages**: Files are sent as messages, split into chunks to manage large files.
- **Receiving Messages**: Host receives file chunks and reconstructs the original file.
- **Disconnecting**: Closes the connection after the file transfer is complete.
- **Plain JavaScript Implementation**: Uses vanilla JavaScript without any frameworks for simplicity.

## How to Use the Example

### Prerequisites

- A modern web browser (Chrome, Firefox, Edge, etc.).
- An internet connection to access the UHST signaling server.

### Running the Example Locally

1. **Download the Code**: Save the HTML file to a directory on your computer.

2. **Serve the File Locally**: Since UHST requires a server context due to security policies, you need to serve the file using a local web server.

   - **Using Python 3**:

     ```bash
     python3 -m http.server 8080 --bind 0.0.0.0
     ```

   - **Using Node.js**:

     ```bash
     npx http-server -p 8080
     ```

3. **Access the Host Page**:

   - Open your web browser and navigate to `http://localhost:8080` (or `http://127.0.0.1:8080`).

4. **Hosting**:

   - The page will display a Host ID, a QR code, and a shareable link.
   - Share the QR code or link with the client device.

5. **Client Access**:

   - On the client device, open the shared link or scan the QR code.
   - The client interface will prompt you to select a file to send.

6. **Sending a File**:

   - Select the file you wish to send.
   - Click the "Send File" button.
   - The client will send the file to the host in chunks.

7. **Receiving the File**:

   - The host will receive the file chunks and reconstruct the file.
   - A download prompt will appear, allowing you to save the received file.

## Technical Details

- **UHST Library**: Utilizes the UHST JavaScript library for peer-to-peer communication.
- **File Chunking**:
  - Files are split into smaller chunks (e.g., 64 KB) to avoid exceeding message size limits.
  - Chunks are sent sequentially to the host.
  - The host reconstructs the file from the received chunks.

- **Binary Data Handling**:
  - Chunks are read and transmitted as binary data (`ArrayBuffer`).
  - This ensures accurate and efficient data transfer without the overhead of Base64 encoding.

- **User Interface**:
  - **Host Interface**:
    - Displays Host ID, QR code, and shareable link.
    - Includes a "Copy URL" button for easy sharing.
    - Shows status messages for diagnostic purposes.
  - **Client Interface**:
    - Prompts the user to select a file.
    - Displays status messages during the file transfer process.

## Notes

- **File Size Limitations**: While chunking allows for larger files to be transferred, very large files may still be limited by browser memory and performance constraints.
- **Security Considerations**:
  - The example does not include authentication or encryption beyond what UHST provides.
  - Use caution when transferring sensitive files.
- **Compatibility**:
  - Tested on modern browsers.
  - Ensure that JavaScript is enabled and that the browser supports the necessary APIs (e.g., `Blob`, `FileReader`, `WebSockets`).

## Conclusion

This example demonstrates a simple and effective way to transfer files between a client and a host using UHST with file chunking in plain JavaScript. It's a practical demonstration of establishing connections, handling data transmission, and managing file reconstruction on the receiving end.

Feel free to modify and expand upon this example to suit your needs or to integrate into more complex applications.

---

**Disclaimer**: This example is intended for educational purposes and may not be suitable for production use without additional security and error-handling enhancements.