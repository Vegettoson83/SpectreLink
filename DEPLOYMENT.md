# SpectreLink Deployment Guide

## Overview
SpectreLink is a secure tunneling solution that uses Cloudflare Workers to create encrypted proxy connections. It consists of two Cloudflare Workers (entry and exit) and a local SOCKS5 proxy server.

## Files Structure
```
spectrelink/
├── src/
│   ├── lib/
│   │   ├── _helpers.js              # Utility functions
│   │   ├── secure-crypto.js         # Encryption/decryption logic
│   │   └── socks5-helpers.js        # SOCKS5 protocol utilities
│   └── workers/
│       ├── entry-worker.js          # Entry point worker (receives connections)
│       └── exit-worker.js           # Exit point worker (connects to targets)
├── local-proxy-client/
│   └── local-proxy-server.js   # Local SOCKS5 proxy server
├── DEPLOYMENT.md           # This deployment guide
├── package.json
├── README.md
├── wrangler.toml           # Entry worker configuration
└── wrangler-exit.toml      # Exit worker configuration
```

## Prerequisites

1. **Cloudflare Account**: You need a Cloudflare account with Workers access.
2. **Wrangler CLI**: Install the Cloudflare Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
3. **Node.js**: For running the local proxy server (Node.js 18+ recommended).

## Step 1: Generate Shared Key

Generate a secure 64-character hex key (32 bytes):

```bash
# On Linux/macOS:
openssl rand -hex 32

# On Windows (PowerShell) - Note: This generates a complex string, manual truncation might be needed.
# A simpler PowerShell alternative for raw hex bytes which then need formatting:
# -join ((Get-Random -Count 32 -InputObject (0..255)) | ForEach-Object { $_.ToString("X2") })

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Save this key securely** - you'll need it for both workers and the local proxy.

## Step 2: Deploy the Exit Worker

1.  **Login to Wrangler**:
    ```bash
    wrangler login
    ```

2.  **Navigate to your project directory** where `wrangler-exit.toml` and `src/workers/exit-worker.js` are located.

3.  **Deploy the exit worker**:
    Make sure `wrangler-exit.toml` correctly points to `src/workers/exit-worker.js` as its `main` script.
    ```bash
    wrangler deploy --config wrangler-exit.toml
    ```
    *(You might be prompted to give your worker a name if it's the first deployment, e.g., `spectrelink-exit`)*

4.  **Configure allowed domains** (optional but highly recommended for security):
    This secret tells the exit worker which domains it's allowed to connect to.
    ```bash
    # Replace 'spectrelink-exit' if you named your worker differently
    wrangler secret put ALLOWED_DOMAINS --name spectrelink-exit --env production
    # When prompted, enter comma-separated domains: e.g., example.com,api.example.com,*.github.com
    # Or leave empty and press Enter to allow all domains (less secure).
    ```

5.  **Note the worker URL** displayed after deployment. It will be something like:
    `https://spectrelink-exit.your-account-name.workers.dev`

## Step 3: Deploy the Entry Worker

1.  **Navigate to your project directory** where `wrangler.toml` and `src/workers/entry-worker.js` are located.

2.  **Update the entry worker configuration**:
    Edit `wrangler.toml`. Replace the placeholder URLs in the `[env.production.vars]` section with your **actual exit worker URL** noted in the previous step.
    ```toml
    [env.production.vars]
    EXIT_WORKER_URL = "https://spectrelink-exit.your-account-name.workers.dev"
    HTTP_NEXT_HOP_URL = "https://spectrelink-exit.your-account-name.workers.dev" # Often same as EXIT_WORKER_URL
    ```
    Also, ensure the `[[services]]` binding points to the correct name of your deployed exit worker.
    ```toml
    [[services]]
    binding = "EXIT_SERVICE" # This is how entry-worker.js refers to it
    service = "spectrelink-exit" # The actual deployed name of your exit worker
    environment = "production"
    ```

3.  **Deploy the entry worker**:
    Make sure `wrangler.toml` correctly points to `src/workers/entry-worker.js` as its `main` script.
    ```bash
    wrangler deploy --config wrangler.toml
    ```
    *(You might be prompted for a name, e.g., `spectrelink-entry`)*

4.  **Verify Shared Key Configuration**:
    The `SHARED_KEY` for the entry worker is pre-configured directly in `wrangler.toml` for this example distribution (`SHARED_KEY = "eb0ade2f9aa422229a77950e3f6e566f2a8bfd80c1e0b7061aa9aac78c6ddf12"`).

    **IMPORTANT SECURITY NOTE**: While this key is hardcoded for ease of setup in this example, **it is strongly recommended for production or any sensitive deployments to remove this key from `wrangler.toml` and set it using `wrangler secret put SHARED_KEY --name spectrelink-entry --env production`**. Hardcoding secrets in configuration files is a security risk if the repository is public or accessible to unauthorized individuals. The original commented-out lines in `wrangler.toml` provide guidance on using secrets.

5.  **Note the entry worker URL**. It will be something like:
    `https://spectrelink-entry.your-account-name.workers.dev`

## Step 4: Test the Workers

Test that both workers are responding to health checks:

```bash
# Test entry worker (replace with your actual URL)
curl https://spectrelink-entry.your-account-name.workers.dev/health

# Test exit worker (replace with your actual URL)
curl https://spectrelink-exit.your-account-name.workers.dev/health
```

Both should return "OK".

## Step 5: Set Up Local Proxy Server

1.  **Navigate to the project root directory.**

2.  **Install dependencies** (if you haven't already):
    This will install `ws` and any other dependencies listed in `package.json`.
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    The local proxy server (`local-proxy-client/local-proxy-server.js`) requires environment variables. You can set them directly in your shell or use a `.env` file with a tool like `dotenv`.

    Create a `.env` file in the project root:
    ```ini
    # .env
    CF_ENTRY_URL=https://spectrelink-entry.your-account-name.workers.dev
    SHARED_KEY=eb0ade2f9aa422229a77950e3f6e566f2a8bfd80c1e0b7061aa9aac78c6ddf12 # Must match the key in wrangler.toml or set via secret for entry worker
    PROXY_HOST=127.0.0.1
    PROXY_PORT=1080
    # NODE_TLS_REJECT_UNAUTHORIZED=0 # Uncomment if using self-signed certs for local WS endpoint (not typical for CF)
    ```
    Replace with your actual Entry Worker URL and ensure the Shared Key matches the one in the Entry Worker configuration.

4.  **Run the local proxy server**:
    If using a `.env` file and `dotenv` (install with `npm install dotenv`):
    ```bash
    node -r dotenv/config local-proxy-client/local-proxy-server.js
    ```
    Or, if you have `dotenv` as a dev dependency and a script in `package.json` like `"start:local-proxy-env": "node -r dotenv/config local-proxy-client/local-proxy-server.js"`:
    ```bash
    npm run start:local-proxy-env
    ```
    Alternatively, set environment variables directly when running the script (example for Linux/macOS):
    ```bash
    CF_ENTRY_URL="https://spectrelink-entry.your-account-name.workers.dev" \
    SHARED_KEY="your-64-character-hex-key-here" \
    PROXY_PORT="1080" \
    node local-proxy-client/local-proxy-server.js
    ```
    (The script defined in `package.json` `npm run start:local-proxy` can also be used if it doesn't rely on `.env` implicitly).

5.  **Verify the proxy is running**:
    You should see output similar to:
    ```
    🔧 SpectreLink Local SOCKS5 Proxy Server
    ======================================
       Listen Address: 127.0.0.1:1080
       Entry Worker URL: https://spectrelink-entry.your-account-name.workers.dev
       Shared Key Hint: your...here

    🚀 SOCKS5 Proxy listening on 127.0.0.1:1080
       Configure your applications to use SOCKS5 proxy: 127.0.0.1:1080
       (No SOCKS5 username/password required)

    📊 Ready to accept connections...
    ```

## Step 6: Configure Applications

Configure your applications to use the SOCKS5 proxy:

-   **Proxy Host**: `127.0.0.1` (or your `PROXY_HOST` if changed)
-   **Proxy Port**: `1080` (or your `PROXY_PORT` if changed)
-   **Authentication**: None required

### Examples:

**curl**:
```bash
curl --socks5 127.0.0.1:1080 http://httpbin.org/ip
# To test with a specific domain that must pass through the tunnel:
# curl --socks5 127.0.0.1:1080 https://api.github.com/zen (if github.com is allowed)
```

**Firefox**:
1.  Go to Settings → Search for "proxy" → Network Settings.
2.  Select "Manual proxy configuration".
3.  Set SOCKS Host: `127.0.0.1`, Port: `1080`.
4.  Select "SOCKS v5".
5.  Optional: Check "Proxy DNS when using SOCKS v5" if you want DNS resolution to also go through the proxy.
6.  Clear the "No Proxy for" field or ensure it doesn't conflict.

**Chrome/Chromium-based browsers**:
Usually configured via system proxy settings or command-line flags:
```bash
# Example for Linux/macOS, replace 'chrome' with your browser executable
chrome --proxy-server="socks5://127.0.0.1:1080" --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"
```

## Troubleshooting

### Common Issues:

1.  **"SHARED_KEY not configured" or "Master key must be 64 hex characters"**:
    *   Entry Worker: Ensure you set the secret with `wrangler secret put SHARED_KEY --name spectrelink-entry`.
    *   Local Proxy: Ensure `SHARED_KEY` environment variable is set correctly.
    *   Verify the key is exactly 64 valid hexadecimal characters.

2.  **"Failed to establish exit connection" / "Exit worker returned status..."**:
    *   Check the `EXIT_WORKER_URL` in `wrangler.toml` for the entry worker.
    *   Ensure the exit worker (`spectrelink-exit` or your name) is deployed and healthy.
    *   Check logs for the exit worker (`wrangler tail spectrelink-exit`).

3.  **"TCP connection failed" / "Domain not allowed" (from Exit Worker logs)**:
    *   Check if the target domain is in `ALLOWED_DOMAINS` secret of the exit worker.
    *   Verify the exit worker has `tcp_sockets` compatibility flag in `wrangler-exit.toml`.

4.  **"Route not supported"**:
    *   Double-check the worker URLs and paths (`/health`, `/tunnel`, `/proxy`).
    *   Verify both workers deployed successfully and are bound correctly if using service bindings.

5.  **Connection timeouts / WebSocket errors**:
    *   Check Cloudflare Worker logs for both entry and exit workers:
        ```bash
        wrangler tail --format=pretty spectrelink-entry # (or your worker name)
        wrangler tail --format=pretty spectrelink-exit # (or your worker name)
        ```
    *   Verify network connectivity to Cloudflare.
    *   Ensure `CF_ENTRY_URL` for the local proxy starts with `http://` or `https://` (the local proxy will convert to `ws://` or `wss://`).

### Debugging:

**View worker logs**:
Use `wrangler tail` as shown above. Add `--env production` if you specified environments.

**Test WebSocket connection from local client manually (advanced)**:
You can use a tool like `wscat` to test the WebSocket handshake part of the tunnel.
```bash
# Install wscat if not already installed
npm install -g wscat

# This is complex to do manually due to encryption.
# Simpler test: ensure the /tunnel endpoint is recognized by the entry worker,
# even if it gives an error due to bad handshake.
wscat -c wss://spectrelink-entry.your-account-name.workers.dev/tunnel
# Expect it to connect then quickly disconnect with an error if no/bad handshake data is sent.
```

## Security Considerations

1.  **Keep the SHARED_KEY absolutely secret**. Anyone with this key can decrypt traffic or use your tunnel.
    *   If you are using the example setup with the hardcoded key in `wrangler.toml`, be especially mindful of your repository's access controls. For production, always use `wrangler secret put` as described in the comments within `wrangler.toml` and in Step 3.
2.  **Use `ALLOWED_DOMAINS`** on the exit worker to restrict where it can connect. Be as specific as possible.
3.  **Monitor worker usage** in the Cloudflare dashboard for abuse or unexpected activity.
4.  **Rotate the `SHARED_KEY` periodically**. This requires updating the secret on the entry worker and updating the environment variable for all local proxy clients.
5.  **Always use HTTPS (WSS) URLs** for your worker endpoints when configuring `CF_ENTRY_URL`. Wrangler deploys workers with HTTPS by default.
6.  The local proxy server binds to `127.0.0.1` by default. If you change `PROXY_HOST` to `0.0.0.0` or an external IP, ensure your firewall is configured appropriately as it would expose the SOCKS5 proxy to your local network or wider.

## Performance Optimization

1.  **Worker Tiers**: For higher limits and better performance, consider Cloudflare's paid Workers plans.
2.  **Regional Workers**: If targeting specific regions, ensure your workers are deployed optimally. Cloudflare typically handles this, but for specific latency needs, explore options.
3.  **Connection Pooling**: The `SecureTunnelManager` in `local-proxy-server.js` creates a new tunnel (WebSocket) per SOCKS5 connection. For very high connection churn, this could be optimized, but for most use cases, it's robust.
4.  **Monitor Quotas**: Keep an eye on Cloudflare Workers usage limits (CPU time, requests, subrequests, duration).

## Updating

To update the workers:

1.  **Modify the code** in `src/workers/entry-worker.js` or `src/workers/exit-worker.js`.
2.  **Redeploy using Wrangler**:
    ```bash
    # For entry worker
    wrangler deploy --config wrangler.toml

    # For exit worker
    wrangler deploy --config wrangler-exit.toml
    ```
3.  **Restart the local proxy server** (`local-proxy-client/local-proxy-server.js`) if its own code or its dependencies (`secure-crypto.js`, `_helpers.js`, `socks5-helpers.js`) were changed.

## Cost Considerations

-   **Cloudflare Workers**:
    *   **Requests**: Free tier typically includes 100,000 requests/day (combined for all workers). Paid plans (e.g., Workers Unbound at $5/month for 10 million requests + $0.50/million after) offer higher limits.
    *   **CPU Time**: Free tier has limits (e.g., 10ms/request). Paid plans offer higher CPU time (e.g., 50ms, 300ms).
    *   **Duration**: Max execution time per request.
    *   **Outbound Data Transfer**: Typically follows Cloudflare's general data transfer policies (often generous from workers).
-   **TCP Sockets (for Exit Worker)**:
    *   The `connect()` API used for TCP sockets is part of Workers. Its usage might have specific billing implications or be bundled under "Duration" or "CPU time". Review current Cloudflare Workers pricing details.
    *   There might be limits on the number of concurrent open sockets.
-   **Data Egress**: Data leaving Cloudflare's network (from the exit worker to the internet) might be subject to Cloudflare's standard egress fees if it exceeds certain amounts, though often egress from Workers is very cheap or included.

Always check the latest [Cloudflare Workers pricing page](https://workers.cloudflare.com/plans/) for the most up-to-date information.

## Legal Notice

-   Ensure your use of this tool complies with Cloudflare's Terms of Service.
-   Be aware of and comply with all applicable local, state, national, and international laws regarding proxy usage and internet access.
-   Respect the terms of service of any websites or remote services you access through this proxy.
-   If using on a corporate or managed network, ensure compliance with your organization's network policies.

Use responsibly and only for legitimate purposes.
