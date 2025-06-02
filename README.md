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

## Setup & Deployment

This project is designed for Cloudflare Workers.

1.  **Prerequisites**:
    -   Node.js and npm installed.
    -   Cloudflare account and `wrangler` CLI installed and configured (`npm install -g wrangler`).

2.  **Environment Variables**:
    Ensure the following environment variables are configured for your workers in the Cloudflare dashboard or via `wrangler.toml`:

    *   **For `entry-worker.js`**:
        *   `SHARED_KEY`: A 64-character hex string (32 bytes) used as the master key for encrypting session keys.
        *   `EXIT_WORKER_URL`: The URL of your deployed `exit-worker.js`.
        *   `HTTP_NEXT_HOP_URL` (optional, alternative to `EXIT_WORKER_URL` for HTTP proxy): URL for the next hop if not using the exit worker for HTTP proxy.

    *   **For `exit-worker.js`**:
        *   `ALLOWED_DOMAINS` (optional): A comma-separated list of domains that the exit worker is allowed to connect to (e.g., `example.com,api.another.com`).

3.  **Deployment**:
    Use the scripts in `package.json` or `wrangler` commands directly:
    ```bash
    # For the entry worker
    npm run deploy:entry
    # or
    wrangler deploy src/workers/entry-worker.js --name your-entry-worker-name

    # For the exit worker
    npm run deploy:exit
    # or
    wrangler deploy src/workers/exit-worker.js --name your-exit-worker-name
    ```

## Usage

-   **TCP Tunneling**: Connect to the `/tunnel` WebSocket endpoint of the entry worker. The client must perform a handshake, sending an encrypted session key.
-   **HTTP Proxy**: Send POST requests to the `/proxy` endpoint of the entry worker with a JSON body specifying `url`, `method`, `headers`, and `data`. The `data` can be marked as `encrypted`.
