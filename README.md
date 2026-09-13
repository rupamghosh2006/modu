# modu — Monetize Any HTTP API with x402 on Algorand

[![npm version](https://img.shields.io/npm/v/@ruponchain/modu?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ruponchain/modu)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Algorand](https://img.shields.io/badge/Algorand-x402-000000?logo=algorand&logoColor=white)](https://algorand.co)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

`modu` is a developer tool and edge reverse proxy that allows developers to turn any existing HTTP API endpoint into a pay-per-request endpoint settled in Algorand USDC (or ALGO) with **zero payment code** written by the developer.

The CLI communicates with a Fastify control-plane API to register origin URLs and issue proxy endpoints. The edge reverse proxy enforces the official **x402 v2 micropayment protocol** backed by the **GoPlausible facilitator** (`HTTP 402 Payment Required` challenge → client-signed atomic transaction group via `X-PAYMENT` header → facilitator verification & on-chain settlement → `200 OK` with verbatim streaming response + `X-PAYMENT-RESPONSE` settlement receipt).

---

## Architecture & Monorepo Layout

```
modu/
  packages/
    cli/            # The published npm package (`modu` CLI)
    control-plane/  # Fastify + Prisma API: accounts, endpoints, sessions, stats
    proxy/          # Edge reverse proxy & Algorand x402 facilitator
    shared/         # Shared TypeScript types, constants, and utilities
  docker-compose.yml# Local Postgres & Redis setup
```

---

## Quick Start

### 1. Installation

Install globally via npm:

```bash
npm install -g @ruponchain/modu
```

Or run directly with npx:

```bash
npx @ruponchain/modu --help
```

For local development from source:

```bash
npm install
npm run build
cd packages/cli
npm link
```

### 2. Configure Authentication & Payout Wallet

Run `modu config` to authenticate your developer account via browser and link your Algorand payout wallet:

```bash
modu config
```

```text
modu CLI Setup & Configuration
Step 1 of 2: Developer Authentication
Opening browser to authorize CLI: https://modu-to68.onrender.com/cli-auth?token=...
Waiting for authorization in browser...
Successfully authenticated!

Step 2 of 2: Connect Algorand Payout Wallet
? Enter your Algorand payout wallet address: YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A

Configuration Complete!
Account:         Authenticated
Payout Wallet:   YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A
Proxy URL:       https://modu-proxy.onrender.com
All x402 endpoint payments will settle directly to your payout wallet.
```

### 3. Monetize an Endpoint with x402

Run `modu register` (interactive wizard or with command-line flags):

```bash
modu register
```

```text
Monetize an Endpoint with x402 Micropayments
Follow the prompts below to configure your pay-per-request endpoint:

? Origin URL to proxy (e.g. https://httpbin.org/get): https://httpbin.org/get
? Price per request in tokens (e.g. 0.001): 0.02

? Select payment asset:
  1) USDC - USD Coin on Algorand (ASA 10458941) (default)
  2) ALGO - Native Algorand cryptocurrency
Select [1-2] or name (default: USDC): USDC
? Custom proxy path slug (optional, press Enter to auto-generate): 

⚡ Endpoint Registered Successfully!

Endpoint ID:    07ec880f
Proxy URL:      https://modu-proxy.onrender.com/p/f21408
Origin URL:     https://httpbin.org/get
Price:          0.02 USDC
Payout To:       YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A

⚡ Pay via browser:
  modu get https://modu-proxy.onrender.com/p/f21408

💡 Tip: AI agents can also pay this endpoint automatically via MCP.
  Run `modu mcp:serve` to connect it to Claude Desktop or Claude Code.
```

### 4. Call & Pay via `modu get`

Call the proxied endpoint with `modu get`. When challenged with `HTTP 402 Payment Required`, `modu` opens your browser to connect Lute wallet and sign the Algorand micropayment, settling on-chain and streaming back the `200 OK` response:

```bash
modu get https://modu-proxy.onrender.com/p/f21408
```

```text
HTTP/1.1 402 Payment Required
content-type: application/json; charset=utf-8

{"x402Version":1,"accepts":[{"scheme":"exact","network":"algorand-testnet","maxAmountRequired":"20000","asset":"10458941","payTo":"YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A","resource":"https://modu-proxy.onrender.com/p/f21408","nonce":"66379e6e3e533c6bb38192af2f34e3e1"}]}

Settle Micropayment via Lute Wallet
Amount:      0.02 USDC
Recipient:   YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A
Nonce:       66379e6e3e533c6bb38192af2f34e3e1
Network:     algorand-testnet

Opening browser for Lute payment approval: http://127.0.0.1:51988/pay
Waiting for payment approval in Lute (or paste confirmed Algorand TxID here)...
HTTP/1.1 200 OK
x-payment-response: {"status":"settled","txid":"B2XJHZ5Q4CBAUPY6Y4RPRVKWG7IFBFZMD7A5DIMHJC6WCBRXCV7Q","payer":"5HQVA7F4G4EJEZHDA3JT763RPCR5NOPERFI5R4HKAKFZA4WDP55NTXQODY","amount":"20000","asset":"10458941"}

{
  "args": {},
  "headers": { ... },
  "origin": "106.202.7.189",
  "url": "https://httpbin.org/get"
}
```

---

## CLI Commands

### 1. `modu config [address]`
Configure authentication and your Algorand payout destination in a single unified command. If not authenticated, opens a browser to log in and saves credentials locally to `~/.modu/config.json`.
```bash
# Interactive setup (browser login + payout wallet prompt):
modu config

# Configure or update payout address directly:
modu config 2UBKCS6GMACWVLAXDZZ47A46K452Z47H4VNLFDE6K7U7N7Y5P67G3RTHQ4

# Force re-authentication in browser:
modu config --relogin
```

### 2. `modu register`
Monetizes an origin HTTP API endpoint with x402 micropayments. If flags are omitted, launches an interactive wizard. Automatically verifies origin reachability with a 3-second `HEAD` request.
```bash
# Interactive wizard:
modu register

# Or provide flags directly:
modu register --url https://httpbin.org/get --price 0.02 --asset USDC --path my-api
```
Output:
```
⚡ Endpoint Registered Successfully!

Endpoint ID:    07ec880f
Proxy URL:      https://modu-proxy.onrender.com/p/f21408
Origin URL:     https://httpbin.org/get
Price:          0.02 USDC
Payout To:       YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A

⚡ Pay via browser:
  modu get https://modu-proxy.onrender.com/p/f21408

💡 Tip: AI agents can also pay this endpoint automatically via MCP.
  Run `modu mcp:serve` to connect it to Claude Desktop or Claude Code.
```

### 3. `modu get <url>` (alias: `modu call <url>`)
Calls a modu-proxied x402 endpoint from your terminal. When the endpoint responds with an `HTTP 402 Payment Required` challenge, `modu` automatically opens your browser with a payment UI to connect and sign via Lute wallet, waits for on-chain settlement, and retrieves the verbatim `200 OK` response with the settlement receipt.
```bash
# Call an endpoint (opens browser for payment on 402 challenge):
modu get https://modu-proxy.onrender.com/p/f21408

# Pass custom headers:
modu get https://modu-proxy.onrender.com/p/f21408 -H "Authorization: Bearer my-token"

# Supply an existing Algorand payment transaction ID directly:
modu get https://modu-proxy.onrender.com/p/f21408 --txid <txid>

# Run without opening a browser:
modu get https://modu-proxy.onrender.com/p/f21408 --no-browser
```

### 4. `modu list`
Displays a tabular overview of your registered endpoints, prices, today's request count, and revenue:
```bash
modu list
# or JSON:
modu list --json
```

### 5. `modu stats <endpointId>`
Displays total volume, paid requests, revenue breakdown by day, and top payer addresses:
```bash
modu stats 8f2a1c
# or JSON:
modu stats 8f2a1c --json
```

### 6. `modu logs <endpointId> [--follow]`
Inspects recent requests or streams live traffic via Server-Sent Events (SSE):
```bash
# View recent 50 requests:
modu logs 8f2a1c

# Stream live traffic in real-time:
modu logs 8f2a1c --follow

# Limit recent logs count:
modu logs 8f2a1c --limit 100
```

### 7. `modu revoke <endpointId>`
Immediately revokes the route. The edge proxy returns `HTTP 410 Gone` with zero propagation delay.
```bash
modu revoke 8f2a1c
```

### 8. `modu wallet create`
Generates a fresh Algorand keypair locally using `algosdk.generateAccount()`. Prints the public address and the 25-word recovery mnemonic.
> **Security Guarantee**: The private key and mnemonic are generated locally and **never transmitted or stored** by `modu`.
```bash
modu wallet create
# or JSON output:
modu wallet create --json
```

### 9. `modu wallet connect <algorand-address>`
Validates the Algorand address checksum locally and registers it with the control plane as your payout destination for all incoming payments.
```bash
modu wallet connect 2UBKCS6GMACWVLAXDZZ47A46K452Z47H4VNLFDE6K7U7N7Y5P67G3RTHQ4
```

### 10. `modu mcp:serve`
Starts the official modu Model Context Protocol (MCP) server over standard I/O (stdio). Exposes `call_paid_endpoint` and `wallet_info` tools to AI assistants (such as Claude Desktop and Claude Code), enabling agents to discover, preview, and pay for x402-gated endpoints.
```bash
modu mcp:serve
```

---

## Model Context Protocol (MCP) Integration

The **Model Context Protocol (MCP)** is an open standard that lets AI assistants (like Claude Desktop and Claude Code) securely connect to external tools and data sources. With the `modu-x402` MCP server, AI agents can directly consume paid APIs—they handle the `HTTP 402` challenge, parse price terms, ask for your confirmation (or auto-pay if configured), sign the Algorand atomic transaction group locally, settle with GoPlausible, and use the returned API data inside their reasoning loop.

### Configuration

Add `modu-x402` to your Claude Desktop configuration (`claude_desktop_config.json`) or Claude Code configuration (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "modu-x402": {
      "command": "npx",
      "args": ["modu", "mcp:serve"],
      "env": {
        "ALGORAND_MNEMONIC": "your 25-word mnemonic",
        "MODU_MCP_AUTO_PAY": "false"
      }
    }
  }
}
```

- **`ALGORAND_MNEMONIC`**: Your 25-word Algorand account recovery phrase used to sign USDC micropayments.
- **`MODU_MCP_AUTO_PAY`**: 
  - `false` (default & recommended): Claude prompts you with price, recipient, and asset details before signing any payment. Claude previews the terms, asks for your approval, and re-invokes with `confirm: true`.
  - `true`: Bypasses preview confirmation and signs payments immediately (intended for trusted, low-value automated workflows).

### Available Tools

1. **`call_paid_endpoint`**
   - Arguments: `{ "url": string, "confirm"?: boolean }`
   - Calls a modu x402-gated endpoint. If payment is required, signs and settles a USDC payment on Algorand via the GoPlausible facilitator, then returns the endpoint's response.
2. **`wallet_info`**
   - Arguments: `{}`
   - Returns the configured Algorand payout/payer address and its current ALGO and USDC balances (read-only, no signing).

### Try It

Once connected to Claude Desktop or Claude Code, you can interact with paid endpoints naturally in chat:

> **User Prompt**:  
> *"Check my wallet balance, then call my modu endpoint at https://modu-proxy.onrender.com/p/c67900 and show me the result."*

**Example Conversation Flow**:
1. Claude calls `wallet_info` and reports your balance:  
   *`"Your wallet (5HQV...ODY) currently has 2.45 ALGO and 15.00 USDC."`*
2. Claude calls `call_paid_endpoint({ "url": "https://modu-proxy.onrender.com/p/c67900" })`.
3. With `MODU_MCP_AUTO_PAY="false"`, the tool returns a confirmation preview:  
   *`"⚠️ Payment Required: 0.02 USDC to YAVQ...JP4A on Algorand TestNet. Would you like me to authorize this payment?"`*
4. You reply: *"Yes, proceed."*
5. Claude re-invokes `call_paid_endpoint({ "url": "https://modu-proxy.onrender.com/p/c67900", "confirm": true })`.
6. Payment is signed and settled on-chain via GoPlausible, and Claude displays the live API data along with the settlement transaction ID.

---

## The x402 Protocol Flow

```
   Consumer                         Proxy                   GoPlausible Facilitator         Origin API
      │                               │                                │                        │
      ├───── GET /p/my-endpoint ─────►│                                │                        │
      │                               │                                │                        │
      │◄──── 402 Payment Required ────┤                                │                        │
      │      (x402 v2 exact scheme,   │                                │                        │
      │       CAIP-2 network & terms) │                                │                        │
      │                               │                                │                        │
 [Signs atomic txn group locally]     │                                │                        │
      │                               │                                │                        │
      ├───── GET /p/my-endpoint ─────►│                                │                        │
      │      Header: X-PAYMENT        │                                │                        │
      │      (base64 PaymentPayload)  │                                │                        │
      │                               ├─ POST /verify ────────────────►│                        │
      │                               │  (simulates group on-chain)    │                        │
      │                               │◄─ { isValid: true } ───────────┤                        │
      │                               │                                │                        │
      │                               ├─ POST /settle ────────────────►│                        │
      │                               │  (co-signs fee-payer txn and   │                        │
      │                               │   broadcasts to Algorand)      │                        │
      │                               │◄─ { success: true, txid, ... }─┤                        │
      │                               │                                │                        │
      │                               ├─ Replay check (txid spent)     │                        │
      │                               │                                │                        │
      │                               ├────────── Forward req stream ──────────────────────────►│
      │                               │◄───────── Stream origin response ───────────────────────┤
      │                               │                                │                        │
      │◄──── 200 OK + Stream ─────────┤                                │                        │
      │      Headers:                 │                                │                        │
      │      X-PAYMENT-RESPONSE       │                                │                        │
      │      PAYMENT-RESPONSE         │                                │                        │
```

---

## Running Tests

Run the test suite across all workspaces:

```bash
npm test
```

Or test packages individually:

```bash
# Test CLI (config, wallet generation & checksum, commands with mocked control plane)
npm --prefix packages/cli test

# Test Proxy (verifier, replay prevention, streaming forwarder)
npm --prefix packages/proxy test

# Test Control Plane (auth token claim, endpoints CRUD, stats)
npm --prefix packages/control-plane test
```

---

## Infrastructure & Deployment

### 1. Local Containerized Stack (Docker Compose)

Run the full stack locally with a single command:

```bash
docker compose up --build -d
```

This starts:
- **`modu-control-plane`**: `http://localhost:3000` (with persistent volume `modu_data`)
- **`modu-proxy`**: `http://localhost:4000`
- **`modu-postgres`**: `localhost:5432`
- **`modu-redis`**: `localhost:6379`

---

### 2. Deploy to Render (Blueprint / 1-Click)

This repository includes a [`render.yaml`](./render.yaml) Blueprint that defines both services with automated HTTPS:

1. Push this repository to GitHub or GitLab.
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** → **Blueprint**.
4. Select your repository. Render automatically reads `render.yaml` and configures:
   - **Control Plane**: Web service with a 1 GB persistent disk for endpoint/account data.
   - **Edge Proxy**: Web service connected to the Control Plane.
5. Click **Apply**. Once built, you'll receive public HTTPS URLs (e.g., `https://modu-to68.onrender.com` and `https://modu-proxy.onrender.com`).

---

### 3. Deploy to Railway

1. Push this repository to GitHub.
2. In [Railway Dashboard](https://railway.app), click **New Project** → **Deploy from GitHub repo**.
3. Add **Service 1 (Control Plane)**:
   - Build Source: Select `Dockerfile.control-plane`
   - Attach a Volume at `/data`
   - Set variables: `PORT=3000`, `HOST=0.0.0.0`, `MODU_STORE_PATH=/data/control-plane-store.json`
4. Add **Service 2 (Proxy)**:
   - Build Source: Select `Dockerfile.proxy`
   - Set variables: `CONTROL_PLANE_URL=https://${{modu-control-plane.RAILWAY_PUBLIC_DOMAIN}}`, `PROXY_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, `FACILITATOR_URL=https://facilitator.goplausible.xyz`

---

### 4. Edge Proxy Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port for the edge proxy |
| `HOST` | `0.0.0.0` | Host interface to bind |
| `CONTROL_PLANE_URL` | `https://modu-to68.onrender.com` | Upstream control-plane URL for endpoint lookups & logs |
| `PROXY_URL` | `https://modu-proxy.onrender.com` | Public base URL of the proxy (used in challenges) |
| `FACILITATOR_URL` | `https://facilitator.goplausible.xyz` | GoPlausible x402 facilitator endpoint for `/verify` & `/settle` |
| `NETWORK` | `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` | Target Algorand CAIP-2 network (TestNet or MainNet) |
| `CHALLENGE_TIMEOUT_SECONDS` | `300` | Expiration window (seconds) for 402 payment requirements |
| `USE_LOCAL_VERIFIER` | `false` | Enable legacy local indexer verifier fallback path |

---

### 5. Connecting Your Local CLI to the Cloud Backends

Once deployed, set environment variables to point your CLI to the live services:

```powershell
# PowerShell
$env:MODU_CONTROL_PLANE_URL = "https://your-control-plane.onrender.com"
$env:MODU_PROXY_URL = "https://your-proxy.onrender.com"

# Authenticate and configure payout wallet against the cloud control plane:
modu config

# Register an endpoint:
modu register --url https://httpbin.org/get --price 0.02 --asset USDC --path my-api
```

Or on Linux/macOS:

```bash
export MODU_CONTROL_PLANE_URL="https://your-control-plane.onrender.com"
export MODU_PROXY_URL="https://your-proxy.onrender.com"
modu config
```

---

## License

MIT (c) [Rupam Ghosh](https://github.com/rupamghosh2006)

