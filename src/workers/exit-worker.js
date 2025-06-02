import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/_helpers.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle TCP tunnel
    if (request.headers.get('Upgrade') === 'websocket') {
      const target = url.searchParams.get('target');
      if (!target) return new Response('Missing target', { status: 400 });
      return this.handleTcpTunnel(request, target, env);
    }

    // Handle HTTP proxy
    if (request.method === 'POST') {
      return this.handleHttpProxy(request, env);
    }

    return new Response('Route not supported', { status: 404 });
  },

  async handleTcpTunnel(request, target, env) {
    const [host, port] = target.split(':');
    const numericPort = parseInt(port);

    try {
      // This is the Cloudflare Workers 'connect' API for outbound TCP sockets.
      // It's a runtime-provided global, not an internal function to be updated.
      const tcpSocket = connect({ hostname: host, port: numericPort });

      const { 0: clientWs, 1: serverWs } = new WebSocketPair();
      serverWs.accept();

      // Forward data from WebSocket to TCP socket
      serverWs.addEventListener('message', async event => {
        try {
          // Data from entry-worker comes through this WebSocket (serverWs)
          // It should be raw binary data to be sent to the target TCP socket
          // No decryption should be needed here as entry-worker handles session crypto
          let data = event.data;
          if (typeof data === 'string') {
            // If data is string, it's likely base64 encoded by entry-worker's JSON.stringify or similar
            // This part depends on how entry-worker sends data to exit-worker's WebSocket
            // For now, assuming entry-worker sends ArrayBuffer/Uint8Array directly if possible,
            // or that sessionCrypto in entry-worker handles it such that exit-worker receives raw data.
            // The current entry-worker encrypts and puts it in JSON:
            // server.send(JSON.stringify({ type: 'data', payload: encrypted }));
            // This means exit-worker would receive JSON string, not raw data for TCP.
            // This part needs to be aligned with entry-worker's sending logic.
            // For now, this placeholder does not show JSON parsing or specific data extraction.
            // Let's assume for this incomplete version, it expects direct ArrayBuffer.
             console.warn("Exit worker received string data, expecting ArrayBuffer for TCP socket. Conversion might be needed or entry-worker's sending logic adjusted.");
          }
          await tcpSocket.write(data);
        } catch (err) {
          console.error('Error writing to TCP socket or processing message:', err);
          serverWs.send(JSON.stringify({ error: 'Failed to forward data to TCP: ' + err.message }));
        }
      });

      // Forward data from TCP socket to WebSocket
      (async () => {
        try {
          for await (const chunk of tcpSocket.readable) {
            // Data from TCP socket is raw, send it as is via WebSocket to entry-worker
            serverWs.send(chunk);
          }
        } catch (err) {
          console.error('Error reading from TCP socket:', err);
          serverWs.send(JSON.stringify({ error: 'Failed to read data from TCP: ' + err.message }));
        }
      })();

      serverWs.addEventListener('close', event => {
        console.log('WebSocket closed, closing TCP socket:', event.code, event.reason);
        tcpSocket.close().catch(err => console.error('Error closing TCP socket on WS close:', err));
      });
      serverWs.addEventListener('error', event => {
        console.error('WebSocket error, closing TCP socket:', event);
        tcpSocket.close().catch(err => console.error('Error closing TCP socket on WS error:', err));
      });

      // TODO: Handle tcpSocket.closed promise to clean up serverWs if TCP closes first
      tcpSocket.closed.then(() => {
        console.log('TCP socket closed');
        serverWs.close(1000, 'TCP socket closed');
      }).catch(err => {
        console.error('TCP socket closure error:', err);
        serverWs.close(1011, 'TCP socket error');
      });

      return new Response(null, { status: 101, webSocket: clientWs });

    } catch (error) {
      console.error(`TCP connection to ${target} failed:`, error);
      return new Response(`TCP connection failed: ${error.message}`, { status: 502 });
    }
  },

  async handleHttpProxy(request, env) {
    // TODO: Implement HTTP proxy logic
    // This would typically involve:
    // 1. Receiving an encrypted request.
    // 2. Decrypting it (if a session key exchange mechanism is implemented for HTTP).
    // 3. Making the HTTP request to the target.
    // 4. Encrypting the response and sending it back.
    // This part is significantly more complex than the TCP tunnel if security is a concern.
    console.warn('HTTP Proxy functionality is not implemented.');
    return new Response('HTTP Proxy not implemented', { status: 501 });
  }
};
