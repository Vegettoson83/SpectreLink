import { SecureCrypto } from './secure-crypto.js';
import { hexToUint8Array } from './_helpers.js';

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
          const sessionKey = await masterCrypto.decrypt(msg.key);
          
          sessionCrypto = new SecureCrypto();
          sessionCrypto.currentSessionKey = sessionKey;
          
          const exitUrl = new URL(env.EXIT_WORKER_URL);
          exitUrl.searchParams.set('target', msg.target);
          
          const response = await fetch(exitUrl, { headers: { 'Upgrade': 'websocket' } });
          exitWs = response.webSocket;
          exitWs.accept();
          
          exitWs.addEventListener('message', async exitEvent => {
            const encrypted = await sessionCrypto.encrypt(exitEvent.data, sessionCrypto.currentSessionKey);
            server.send(JSON.stringify({ type: 'data', payload: encrypted }));
          });
          
          server.send(JSON.stringify({ type: 'ready' }));
        } 
        else if (msg.type === 'data' && sessionCrypto && exitWs) {
          const decrypted = await sessionCrypto.decrypt(msg.payload, sessionCrypto.currentSessionKey);
          exitWs.send(decrypted);
        }
      } catch (error) {
        console.error('Tunnel error:', error);
        server.close(1011, 'Internal error');
        if (exitWs) exitWs.close(1011);
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  },
  
  async handleHttpProxy(request, env) {
    // ... (implementación HTTP proxy)
  }
};
