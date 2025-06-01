import { arrayBufferToBase64, base64ToArrayBuffer } from './_helpers.js';

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
      const socket = connect({ hostname: host, port: numericPort });
      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      
      // ... (código completo de manejo de sockets del ejemplo anterior)
      
      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      return new Response(`TCP connection failed: ${error.message}`, { status: 502 });
    }
  },
  
  async handleHttpProxy(request, env) {
    // ... (implementación HTTP proxy)
  }
};
