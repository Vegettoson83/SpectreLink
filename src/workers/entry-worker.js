import { SecureCrypto } from '../lib/secure-crypto.js';
// Note: Removed unused import of hexToUint8Array from ../lib/_helpers.js

let masterCryptoInstance = null;

function getMasterCrypto(env) {
  if (!env.SHARED_KEY) throw new Error("SHARED_KEY not configured");
  if (!masterCryptoInstance) {
    masterCryptoInstance = new SecureCrypto(env.SHARED_KEY);
  }
  return masterCryptoInstance;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle WebSocket tunnel
    if (url.pathname === '/tunnel' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleTcpTunnel(request, env);
    }

    // Handle HTTP proxy
    if (request.method === 'POST') {
      return this.handleHttpProxy(request, env);
    }

    return new Response('Route not supported', { status: 404 });
  },

  async handleTcpTunnel(request, env) {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    let sessionCrypto = null;
    let exitWs = null;

    server.addEventListener('message', async event => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'handshake') {
          const masterCrypto = getMasterCrypto(env);
          // Assuming masterCrypto.decrypt returns the key directly as Uint8Array
          const sessionKeyArrayBuffer = await masterCrypto.decrypt(msg.key, masterCrypto.masterKey);

          sessionCrypto = new SecureCrypto(); // Create a new instance for the session
          sessionCrypto.currentSessionKey = sessionKeyArrayBuffer; // Store the key (as ArrayBuffer/Uint8Array)

          const exitUrl = new URL(env.EXIT_WORKER_URL);
          exitUrl.searchParams.set('target', msg.target);

          // The 'connect' function mentioned in the requirements seems to be related to Cloudflare's runtime
          // for establishing outbound WebSocket connections from a Worker.
          // However, standard 'fetch' with Upgrade header is used here, which is correct.
          // No 'connect' function call needs to be changed here.
          const response = await fetch(exitUrl, { headers: { 'Upgrade': 'websocket' } });
          if (!response.webSocket) {
            throw new Error("Failed to connect to exit worker: WebSocket upgrade failed.");
          }
          exitWs = response.webSocket;
          // exitWs.accept(); // Client WebSockets don't need accept(), this is done by the server-side of the pair.

          exitWs.addEventListener('open', () => {
            console.log('Exit WebSocket connected');
          });
          exitWs.addEventListener('error', (err) => {
            console.error('Exit WebSocket error:', err);
            server.close(1011, 'Exit connection error');
          });
          exitWs.addEventListener('close', (event) => {
            console.log('Exit WebSocket closed:', event.code, event.reason);
            server.close(event.code, event.reason);
          });

          exitWs.addEventListener('message', async exitEvent => {
            // Data from exit worker is already decrypted (or should be raw TCP data)
            // Encrypt it before sending to the client
            const dataToSend = typeof exitEvent.data === 'string' ? new TextEncoder().encode(exitEvent.data) : exitEvent.data;
            const encrypted = await sessionCrypto.encrypt(dataToSend, sessionCrypto.currentSessionKey);
            server.send(JSON.stringify({ type: 'data', payload: encrypted }));
          });

          server.send(JSON.stringify({ type: 'ready' }));
        }
        else if (msg.type === 'data' && sessionCrypto && exitWs && exitWs.readyState === WebSocket.OPEN) {
          // Data from client, decrypt it and send to exit worker
          const decrypted = await sessionCrypto.decrypt(msg.payload, sessionCrypto.currentSessionKey);
          exitWs.send(decrypted);
        } else if (exitWs && exitWs.readyState !== WebSocket.OPEN) {
          console.warn('Exit WebSocket is not open. Current state:', exitWs.readyState);
          // Optionally, handle data if needed or just let it fail.
        }
      } catch (error) {
        console.error('Tunnel error:', error);
        server.close(1011, 'Internal error: ' + error.message);
        if (exitWs) exitWs.close(1011, 'Upstream error');
      }
    });

    server.addEventListener('close', event => {
      console.log('Client WebSocket closed:', event.code, event.reason);
      if (exitWs) {
        exitWs.close(event.code, event.reason);
      }
    });
    server.addEventListener('error', err => {
      console.error('Client WebSocket error:', err);
      if (exitWs) {
        exitWs.close(1011, 'Client error');
      }
    });


    return new Response(null, { status: 101, webSocket: client });
  },

  async handleHttpProxy(request, env) {
    // TODO: Implement HTTP proxy logic if necessary
    // This might involve:
    // 1. Decrypting the incoming request payload using SecureCrypto.
    // 2. Making a fetch request to the target URL.
    // 3. Encrypting the response from the target and sending it back.
    console.warn('HTTP Proxy functionality is not fully implemented.');
    return new Response('HTTP Proxy not implemented', { status: 501 });
  }
};
