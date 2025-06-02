import net from 'node:net';
import { WebSocket } from 'ws';
import { SecureCrypto } from '../src/lib/secure-crypto.js';
import { parseSocks5ConnectRequest, createSocks5Response, SOCKS5_STATUS } from '../src/lib/socks5-helpers.js';
import '../src/lib/_helpers.js';

class SecureTunnelManager {
  constructor(entryUrl, sharedKey) {
    this.entryUrl = entryUrl;
    this.crypto = new SecureCrypto(sharedKey);
    this.activeTunnels = new Map();
  }

  async createTunnel(target) {
    return new Promise((resolve, reject) => {
      const tunnelId = Math.random().toString(36).substr(2, 9);
      console.log(`Creating tunnel ${tunnelId} to ${target}`);

      // Generate session key and encrypt it
      const sessionKey = this.crypto.generateSessionKey();

      this.crypto.encryptSessionKey(sessionKey).then(encryptedKey => {
        const wsUrl = `${this.entryUrl.replace(/^http/, 'ws')}/tunnel`; // Ensure ws or wss
        const ws = new WebSocket(wsUrl);

        let isReady = false;
        const tunnel = {
          id: tunnelId,
          ws,
          sessionKey,
          crypto: new SecureCrypto(), // Instance for this tunnel's session
          target,
          isReady: false,
          onData: null,
          onClose: null,
          onError: null,
          pingInterval: null,
          lastPong: Date.now()
        };

        tunnel.crypto.currentSessionKey = sessionKey;
        this.activeTunnels.set(tunnelId, tunnel);

        ws.on('open', () => {
          console.log(`Tunnel ${tunnelId} WebSocket connected to ${wsUrl}`);
          ws.send(JSON.stringify({
            type: 'handshake',
            key: encryptedKey,
            target: target
          }));
        });

        ws.on('message', async (data) => {
          try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'ready') {
              console.log(`Tunnel ${tunnelId} ready for target ${target}`);
              tunnel.isReady = true;
              isReady = true;
              resolve(tunnel);
            }
            else if (msg.type === 'data') {
              const decrypted = await tunnel.crypto.decrypt(msg.payload, sessionKey);
              if (tunnel.onData) {
                tunnel.onData(decrypted);
              } else {
                console.warn(`Tunnel ${tunnelId} received data but no onData handler is set.`);
              }
            }
            else if (msg.type === 'error') {
              console.error(`Tunnel ${tunnelId} received error from server:`, msg.message);
              if (!isReady) reject(new Error(msg.message));
              if (tunnel.onError) tunnel.onError(new Error(msg.message));
              ws.close(1011, msg.message); // Close WebSocket on server-side error
              this.activeTunnels.delete(tunnelId);
            }
            else if (msg.type === 'pong') {
              tunnel.lastPong = Date.now();
            }
          } catch (error) {
            console.error(`Tunnel ${tunnelId} error processing message:`, error);
            // Consider closing the tunnel or notifying onError handler
          }
        });

        ws.on('close', (code, reason) => {
          console.log(`Tunnel ${tunnelId} WebSocket closed: ${code} - ${reason ? reason.toString() : 'No reason'}`);
          if (tunnel.pingInterval) clearInterval(tunnel.pingInterval);
          this.activeTunnels.delete(tunnelId);
          if (tunnel.onClose) tunnel.onClose(code, reason);
          if (!isReady && code !== 1000) { // If not ready and not a normal close, reject promise
              reject(new Error(`Tunnel ${tunnelId} closed before ready: ${code} ${reason ? reason.toString() : ''}`));
          }
        });

        ws.on('error', (error) => {
          console.error(`Tunnel ${tunnelId} WebSocket error:`, error);
          if (tunnel.pingInterval) clearInterval(tunnel.pingInterval);
          if (!isReady) {
            reject(error);
          }
          if (tunnel.onError) tunnel.onError(error);
          this.activeTunnels.delete(tunnelId);
        });

        tunnel.pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            if (Date.now() - tunnel.lastPong > 45000) { // No pong in 45s
                console.warn(`Tunnel ${tunnelId}: No pong received recently. Closing.`);
                ws.terminate(); // Force close
            } else {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
          } else {
             if (tunnel.pingInterval) clearInterval(tunnel.pingInterval);
          }
        }, 30000);

      }).catch(error => {
        console.error(`Tunnel ${tunnelId} setup error (encrypting session key):`, error);
        reject(error);
      });
    });
  }

  async sendData(tunnel, data) {
    if (!tunnel || !tunnel.isReady || !tunnel.ws || tunnel.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Tunnel ${tunnel ? tunnel.id : 'unknown'} not ready or WebSocket not open`);
    }

    try {
      const encrypted = await tunnel.crypto.encrypt(data, tunnel.sessionKey);
      tunnel.ws.send(JSON.stringify({
        type: 'data',
        payload: encrypted
      }));
    } catch (error) {
      console.error(`Error sending data through tunnel ${tunnel.id}:`, error);
      throw error;
    }
  }

  closeTunnel(tunnelOrId) {
    const tunnelId = typeof tunnelOrId === 'string' ? tunnelOrId : tunnelOrId.id;
    const tunnel = this.activeTunnels.get(tunnelId);

    if (tunnel) {
      console.log(`Closing tunnel ${tunnel.id}`);
      if (tunnel.pingInterval) {
        clearInterval(tunnel.pingInterval);
      }
      if (tunnel.ws && (tunnel.ws.readyState === WebSocket.OPEN || tunnel.ws.readyState === WebSocket.CONNECTING)) {
        tunnel.ws.close(1000, 'Client requested tunnel closure');
      }
      this.activeTunnels.delete(tunnel.id);
    }
  }
}

class Socks5Proxy {
  constructor(entryUrl, sharedKey) {
    this.tunnelManager = new SecureTunnelManager(entryUrl, sharedKey);
  }

  async handleConnection(socket) {
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`New SOCKS5 connection from ${clientAddress}`);
    let tunnel = null; // Keep track of the tunnel for this connection

    try {
      await this.handleAuth(socket);
      const { host, port, rawHost, rawPort, atyp } = await this.handleConnectRequest(socket); // Get raw address parts too
      const target = `${host}:${port}`;
      console.log(`SOCKS5 request from ${clientAddress} to target: ${target}`);

      tunnel = await this.tunnelManager.createTunnel(target);
      console.log(`Tunnel ${tunnel.id} established for ${clientAddress} to ${target}`);

      // Send success response - use original address type if possible
      socket.write(createSocks5Response(SOCKS5_STATUS.SUCCESS, host, port, atyp));

      tunnel.onData = (data) => {
        if (!socket.destroyed) {
          socket.write(data);
        }
      };

      tunnel.onClose = (code, reason) => {
        console.log(`Tunnel ${tunnel.id} for ${clientAddress} closed by server: ${code} ${reason ? reason.toString() : ''}`);
        if (!socket.destroyed) {
          socket.end();
        }
      };

      tunnel.onError = (error) => {
        console.error(`Tunnel ${tunnel.id} for ${clientAddress} error:`, error);
        if (!socket.destroyed) {
          socket.end();
        }
      };

      socket.on('data', async (data) => {
        if (!tunnel || !tunnel.isReady) {
          console.warn(`SOCKS5 data from ${clientAddress} but tunnel ${tunnel ? tunnel.id : 'N/A'} not ready. Discarding.`);
          return;
        }
        try {
          await this.tunnelManager.sendData(tunnel, data);
        } catch (error) {
          console.error(`Error forwarding SOCKS5 data from ${clientAddress} to tunnel ${tunnel.id}:`, error);
          if (!socket.destroyed) socket.end();
          this.tunnelManager.closeTunnel(tunnel);
        }
      });

      socket.on('close', () => {
        console.log(`SOCKS5 socket for ${clientAddress} (tunnel ${tunnel ? tunnel.id : 'N/A'}) closed.`);
        if (tunnel) this.tunnelManager.closeTunnel(tunnel);
      });

      socket.on('error', (error) => {
        console.error(`SOCKS5 socket error for ${clientAddress} (tunnel ${tunnel ? tunnel.id : 'N/A'}):`, error);
        if (tunnel) this.tunnelManager.closeTunnel(tunnel);
        if (!socket.destroyed) socket.end();
      });

    } catch (error) {
      console.error(`SOCKS5 connection error for ${clientAddress}:`, error.message);
      if (tunnel) { // If tunnel was created but something failed afterwards
        this.tunnelManager.closeTunnel(tunnel);
      }
      if (!socket.destroyed) {
        let errorCode = SOCKS5_STATUS.GENERAL_FAILURE;
        if (error.message.includes('Unsupported SOCKS version')) errorCode = SOCKS5_STATUS.COMMAND_NOT_SUPPORTED;
        else if (error.message.includes('No acceptable authentication methods')) errorCode = SOCKS5_STATUS.GENERAL_FAILURE; // Client should not proceed
        else if (error.message.includes('Only CONNECT')) errorCode = SOCKS5_STATUS.COMMAND_NOT_SUPPORTED;
        else if (error.message.includes('Unsupported address type')) errorCode = SOCKS5_STATUS.ADDRESS_TYPE_NOT_SUPPORTED;
        else if (error.message.includes('not allowed')) errorCode = SOCKS5_STATUS.CONNECTION_NOT_ALLOWED;
        else if (error.message.includes('unreachable') || error.message.includes('ETIMEDOUT') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED') && error.message.includes('exit worker')) {
             errorCode = SOCKS5_STATUS.HOST_UNREACHABLE; // Error from tunnel creation (exit worker)
        } else if (error.message.includes('refused')) errorCode = SOCKS5_STATUS.CONNECTION_REFUSED; // from local socket or tunnel

        socket.write(createSocks5Response(errorCode));
        socket.end();
      }
    }
  }

  async handleAuth(socket) {
    return new Promise((resolve, reject) => {
      const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
      const timeout = setTimeout(() => {
        reject(new Error(`SOCKS5 Auth timeout for ${clientInfo}`));
      }, 10000); // 10 seconds

      socket.once('data', (data) => {
        clearTimeout(timeout);
        try {
          if (data.length < 2 || data[0] !== 0x05) { // VER needs to be 0x05
            return reject(new Error(`Invalid SOCKS5 auth request version from ${clientInfo}: ${data[0]}`));
          }
          const nMethods = data[1];
          if (data.length !== 2 + nMethods) {
            return reject(new Error(`Invalid SOCKS5 auth methods length from ${clientInfo}`));
          }
          const methods = data.slice(2, 2 + nMethods);
          if (methods.includes(0x00)) { // 0x00: No authentication required
            socket.write(Buffer.from([0x05, 0x00]));
            resolve();
          } else {
            socket.write(Buffer.from([0x05, 0xFF])); // 0xFF: No acceptable methods
            reject(new Error(`No acceptable SOCKS5 auth methods from ${clientInfo}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async handleConnectRequest(socket) {
    return new Promise((resolve, reject) => {
      const clientInfo = `${socket.remoteAddress}:${socket.remotePort}`;
      const timeout = setTimeout(() => {
        reject(new Error(`SOCKS5 Connect request timeout for ${clientInfo}`));
      }, 10000); // 10 seconds

      socket.once('data', (data) => {
        clearTimeout(timeout);
        try {
          const parsedRequest = parseSocks5ConnectRequest(data); // Returns { host, port, atyp, rawHost, rawPort }
          resolve(parsedRequest);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

// Configuration and server startup
const PROXY_LISTEN_HOST = process.env.PROXY_HOST || '127.0.0.1';
const PROXY_LISTEN_PORT = parseInt(process.env.PROXY_PORT || "1080", 10);
const CF_ENTRY_URL = process.env.CF_ENTRY_URL;
const SHARED_KEY = process.env.SHARED_KEY;

if (!SHARED_KEY || !CF_ENTRY_URL) {
  console.error("ERROR: You must configure CF_ENTRY_URL and SHARED_KEY environment variables");
  console.error("Example:");
  console.error("  export CF_ENTRY_URL=\"https://your-entry-worker.your-account.workers.dev\"");
  console.error("  export SHARED_KEY=\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(SHARED_KEY)) {
  console.error("ERROR: SHARED_KEY must be a 64-character hexadecimal string (32 bytes)");
  console.error("You can generate one with: openssl rand -hex 32");
  process.exit(1);
}

if (isNaN(PROXY_LISTEN_PORT) || PROXY_LISTEN_PORT < 1 || PROXY_LISTEN_PORT > 65535) {
  console.error("ERROR: PROXY_PORT must be a number between 1 and 65535");
  process.exit(1);
}

console.log('🔧 SpectreLink Local SOCKS5 Proxy Server');
console.log('======================================');
console.log(`   Listen Address: ${PROXY_LISTEN_HOST}:${PROXY_LISTEN_PORT}`);
console.log(`   Entry Worker URL: ${CF_ENTRY_URL}`);
console.log(`   Shared Key Hint: ${SHARED_KEY.substring(0, 4)}...${SHARED_KEY.substring(60)}`);
console.log('');

const socksServer = new Socks5Proxy(CF_ENTRY_URL, SHARED_KEY);

const server = net.createServer(socket => {
  socksServer.handleConnection(socket).catch(error => {
    // This catch is a safety net, errors should ideally be handled within handleConnection
    console.error('Critical unhandled error in SOCKS5 connection handler:', error);
    if (socket && !socket.destroyed) {
      socket.end();
    }
  });
});

server.listen(PROXY_LISTEN_PORT, PROXY_LISTEN_HOST, () => {
  console.log(`🚀 SOCKS5 Proxy listening on ${PROXY_LISTEN_HOST}:${PROXY_LISTEN_PORT}`);
  console.log(`   Configure your applications to use SOCKS5 proxy: ${PROXY_LISTEN_HOST}:${PROXY_LISTEN_PORT}`);
  console.log('   (No SOCKS5 username/password required)');
  console.log('');
  console.log('📊 Ready to accept connections...');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ERROR: Address ${PROXY_LISTEN_HOST}:${PROXY_LISTEN_PORT} is already in use.`);
    console.error(`       Try a different port, e.g., by setting PROXY_PORT environment variable.`);
  } else if (err.code === 'EACCES') {
    console.error(`ERROR: Permission denied to bind to ${PROXY_LISTEN_HOST}:${PROXY_LISTEN_PORT}.`);
    console.error(`       Try using a port number > 1024 or run with appropriate privileges.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});

function gracefulShutdown(signal) {
    console.log(`
🛑 Received ${signal}. Shutting down SOCKS5 proxy server...`);
    server.close(() => {
        console.log('✅ Server stopped.');
        // Close active tunnels
        if (socksServer && socksServer.tunnelManager && socksServer.tunnelManager.activeTunnels) {
            console.log('Closing active tunnels...');
            socksServer.tunnelManager.activeTunnels.forEach(tunnel => {
                socksServer.tunnelManager.closeTunnel(tunnel);
            });
        }
        process.exit(0);
    });

    // Force shutdown if server doesn't close gracefully
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000); // 10 seconds
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
