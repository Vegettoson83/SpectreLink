# Secure Proxy and Tunneling Service

This project implements a secure proxy and tunneling service using Cloudflare Workers. It consists of an entry worker that handles client requests and an exit worker that forwards traffic to the target destination. Communication between the client and the entry worker, and potentially between the entry worker and sensitive data, is secured using AES-GCM encryption.

## Components

### 1. Entry Worker (`src/workers/entry-worker.js`)
-   Acts as the primary interface for clients.
-   Handles incoming WebSocket connections for TCP tunneling (`/tunnel`).
    -   Performs a handshake where a session key (encrypted with a shared master key) is received from the client.
    -   Decrypts the session key and uses it to encrypt/decrypt data tunneled to/from an exit worker.
-   Handles incoming HTTP requests for proxying (`/proxy`).
    -   Can decrypt encrypted request bodies if specified.
    -   Forwards HTTP requests to an exit worker or a configured next hop.
-   Provides a health check endpoint (`/health`).
-   Requires the `SHARED_KEY` and `EXIT_WORKER_URL` (or `HTTP_NEXT_HOP_URL`) environment variables.

### 2. Exit Worker (`src/workers/exit-worker.js`)
-   Receives requests from the entry worker.
-   Handles TCP tunneling requests:
    -   Connects to the specified target host and port.
    -   Proxies data between the WebSocket connection (from the entry worker) and the target TCP server.
-   Handles HTTP proxy requests:
    -   Makes outbound HTTP requests to the specified URL.
-   Can be configured with `ALLOWED_DOMAINS` to restrict access to specific target domains for both TCP and HTTP proxying.
-   Provides a health check endpoint (`/health`).

### 3. Cryptography Library (`src/lib/secure-crypto.js`)
-   Provides the `SecureCrypto` class for AES-GCM encryption and decryption.
-   Manages master keys and session keys.

### 4. Helpers (`src/lib/_helpers.js`)
-   Includes polyfills for `btoa`/`atob` in Node.js.
-   Provides utility functions for hex string <-> Uint8Array and ArrayBuffer <-> Base64 conversions.

### 5. SOCKS5 Helpers (`src/lib/socks5-helpers.js`)
-   Provides utility functions for working with the SOCKS5 protocol.
-   Includes:
    -   `parseSocks5ConnectRequest`: Parses SOCKS5 client CONNECT requests.
    -   `createSocks5Response`: Creates SOCKS5 server responses.
    -   `SOCKS5_STATUS`: An object mapping SOCKS5 status codes to their hex values.
-   **Note**: These functions rely on the Node.js `Buffer` object. For use in Cloudflare Workers, ensure Node.js compatibility mode is enabled (e.g., by adding `nodejs_compat = true` to your `wrangler.toml`) or provide a `Buffer` polyfill.

## Project Structure

```
spectrelink/
├── src/
│   ├── lib/
│   │   ├── _helpers.js              # Utility functions
│   │   ├── secure-crypto.js         # Encryption/decryption logic
│   │   └── socks5-helpers.js        # SOCKS5 protocol utilities
│   └── workers/
│       ├── entry-worker.js          # Entry point Cloudflare Worker
│       └── exit-worker.js           # Exit point Cloudflare Worker
├── local-proxy-client/
│   └── local-proxy-server.js   # Local SOCKS5 proxy server (Node.js)
├── DEPLOYMENT.md               # Detailed guide for deploying workers and setting up the client
├── package.json                # Project metadata, dependencies, and scripts
├── README.md                   # This overview file
├── wrangler.toml               # Configuration for the Entry Worker
└── wrangler-exit.toml          # Configuration for the Exit Worker
```

## Setup & Deployment

This project involves deploying two Cloudflare Workers (entry and exit) and running a local SOCKS5 proxy client.

**For detailed, step-by-step instructions, please refer to the [SpectreLink Deployment Guide](./DEPLOYMENT.md).**

The `DEPLOYMENT.md` covers:
- Prerequisites (Cloudflare account, Wrangler CLI, Node.js).
- Generating a shared secret key.
- Deploying the exit worker using `wrangler-exit.toml`.
- Deploying the entry worker using `wrangler.toml`.
- Configuring environment variables and secrets for both workers.
- Setting up and running the local SOCKS5 proxy client.
- Testing the setup.

### Worker Configuration Files
-   `wrangler.toml`: Configuration file for deploying the `entry-worker.js` to Cloudflare Workers. It includes settings for the worker name, main script path, compatibility flags, environment variables (like `EXIT_WORKER_URL`), and service bindings.
-   `wrangler-exit.toml`: Configuration file for deploying the `exit-worker.js`. It specifies settings for the exit worker, including its `tcp_sockets` compatibility flag and how to configure `ALLOWED_DOMAINS` via secrets.

## Usage

-   **TCP Tunneling**: Connect to the `/tunnel` WebSocket endpoint of the entry worker. The client must perform a handshake, sending an encrypted session key.
-   **HTTP Proxy**: Send POST requests to the `/proxy` endpoint of the entry worker with a JSON body specifying `url`, `method`, `headers`, and `data`. The `data` can be marked as `encrypted`.

## Local SOCKS5 Proxy Client (`local-proxy-client/`)

This project also includes a local SOCKS5 proxy server client that runs on your machine. It allows local applications to route their traffic through the secure tunnel system via a standard SOCKS5 interface.

### Purpose
-   Listens for incoming SOCKS5 connections on a local port.
-   For each connection, it establishes a secure tunnel to the configured Entry Worker.
-   Proxies data between the local application and the remote target through this secure tunnel.

### Dependencies
-   Node.js (version recommended by `ws` package, typically a recent LTS)
-   `ws`: WebSocket client library. This will be installed via `npm install`.

### Configuration
The local SOCKS5 proxy client is configured using the following environment variables:

-   `PROXY_HOST`: (Optional) The local IP address for the SOCKS5 proxy to listen on. Defaults to `127.0.0.1`.
-   `PROXY_PORT`: (Optional) The local port for the SOCKS5 proxy to listen on. Defaults to `1080`.
-   `CF_ENTRY_URL`: **(Required)** The full URL of your deployed Entry Worker (e.g., `https://your-entry-worker.your-account.workers.dev`).
-   `SHARED_KEY`: **(Required)** The 64-character hex string (32 bytes) master key, identical to the one configured for the Entry Worker.

Example:
```bash
export CF_ENTRY_URL="https://your-entry-worker.example.com"
export SHARED_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
export PROXY_PORT="1088"
```

### Setup and Running
1.  **Install Dependencies**:
    Navigate to the project root directory and run:
    ```bash
    npm install
    ```
    This will install the `ws` library and other development dependencies.

2.  **Run the Server**:
    Ensure the environment variables (`CF_ENTRY_URL`, `SHARED_KEY`, and optionally `PROXY_HOST`, `PROXY_PORT`) are set. Then run:
    ```bash
    npm run start:local-proxy
    ```
    Or directly:
    ```bash
    node local-proxy-client/local-proxy-server.js
    ```

3.  **Configure Your Application**:
    Set your local application's SOCKS5 proxy settings to the address and port the `local-proxy-server.js` is listening on (e.g., `127.0.0.1:1080` or `127.0.0.1:1088` if you set `PROXY_PORT`). No username or password is required for the SOCKS5 proxy.
