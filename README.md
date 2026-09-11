# modu — Monetize Any HTTP API with x402 on Algorand

`modu` is a developer tool and edge reverse proxy that allows developers to turn any existing HTTP API endpoint into a pay-per-request endpoint settled in Algorand USDC (or ALGO) with **zero payment code** written by the developer.

The CLI communicates with a Fastify control-plane API to register origin URLs and issue proxy endpoints. The edge reverse proxy enforces the **x402 micropayment protocol** (`HTTP 402 Payment Required` challenge → signed on-chain payment → retry with `X-PAYMENT-TXID` → `200 OK` with verbatim streaming response + `X-PAYMENT-RESPONSE` settlement receipt).

---

## 🏗️ Architecture & Monorepo Layout

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

## ⚡ Quick Start

### 1. Installation

Install dependencies and build packages:

```bash
npm install
npm run build
```

Link the CLI locally:

```bash
cd packages/cli
npm link
```

Verify zero-config help works:

```bash
modu --help
```

---

## 💻 CLI Commands

### 1. `modu login`
Opens a browser to authorize the CLI session. Polls the control plane and saves a long-lived API key to `~/.modu/config.json` with secure permissions (`0600`).
```bash
modu login
# or output raw JSON:
modu login --json
```

### 2. `modu wallet create`
Generates a fresh Algorand keypair locally using `algosdk.generateAccount()`. Prints the public address and the 25-word recovery mnemonic.
> ⚠️ **Security Guarantee**: The private key and mnemonic are generated locally and **never transmitted or stored** by `modu`.
```bash
modu wallet create
```

### 3. `modu wallet connect <algorand-address>`
Validates the Algorand address checksum locally and registers it with the control plane as your payout destination for all incoming payments.
```bash
modu wallet connect 2UBKCS6GMACWVLAXDZZ47A46K452Z47H4VNLFDE6K7U7N7Y5P67G3RTHQ4
```

### 4. `modu register --url <url> --price <amount> --asset <USDC|ALGO> [--path <slug>]`
Monetizes an origin HTTP API endpoint. Automatically tests origin reachability with a 3-second `HEAD` request.
```bash
modu register --url https://api.my-service.com/v1/generate --price 0.01 --asset USDC --path generate
```
Output:
```
⚡ Endpoint Registered Successfully!

Endpoint ID:    8f2a1c
Proxy URL:      http://localhost:4000/p/generate
Origin URL:     https://api.my-service.com/v1/generate
Price:          0.01 USDC
Payout To:      2UBKCS6GMACWVLAXDZZ47A46K452Z47H4VNLFDE6K7U7N7Y5P67G3RTHQ4

Try it with curl:
# 1. Request without payment (HTTP 402 challenge):
curl -i http://localhost:4000/p/generate

# 2. Request with Algorand payment txid:
curl -i -H "X-PAYMENT-TXID: <txid>" http://localhost:4000/p/generate
```

### 5. `modu list`
Displays a tabular overview of your registered endpoints, prices, today's request count, and revenue:
```bash
modu list
# or JSON:
modu list --json
```

### 6. `modu revoke <endpointId>`
Immediately revokes the route. The edge proxy returns `HTTP 410 Gone` with zero propagation delay.
```bash
modu revoke 8f2a1c
```

### 7. `modu logs <endpointId> [--follow]`
Inspects recent requests or streams live traffic via Server-Sent Events (SSE):
```bash
modu logs 8f2a1c
modu logs 8f2a1c --follow
```

### 8. `modu stats <endpointId>`
Displays total volume, paid requests, revenue breakdown by day, and top payer addresses:
```bash
modu stats 8f2a1c
```

---

## 📡 The x402 Protocol Flow

```
   Consumer                       Proxy                        Origin API
      │                             │                              │
      ├──── GET /p/my-endpoint ────►│                              │
      │                             │                              │
      │◄─── 402 Payment Required ───┤                              │
      │     (x402 spec with nonce)  │                              │
      │                             │                              │
      │                             │                              │
 [Algorand Blockchain]              │                              │
      │                             │                              │
      ├─► Sends ASA USDC transfer   │                              │
      │   with Note: "modu:<nonce>" │                              │
      │                             │                              │
      │                             │                              │
      ├──── GET /p/my-endpoint ────►│                              │
      │     Header: X-PAYMENT-TXID  │                              │
      │                             ├─ Indexer verifies tx & round │
      │                             ├─ Validates receiver & amount │
      │                             ├─ Marks nonce/txid spent      │
      │                             │                              │
      │                             ├──── Forward req stream ─────►│
      │                             │◄─── Stream origin response ──┤
      │                             │                              │
      │◄─── 200 OK + Stream ────────┤                              │
      │     Header:                 │                              │
      │     X-PAYMENT-RESPONSE      │                              │
```

---

## 🧪 Running Tests

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

## 🛠️ Infrastructure & Deployment

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
5. Click **Apply**. Once built, you'll receive public HTTPS URLs (e.g., `https://modu-control-plane.onrender.com` and `https://modu-proxy.onrender.com`).

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
   - Set variables: `CONTROL_PLANE_URL=https://${{modu-control-plane.RAILWAY_PUBLIC_DOMAIN}}`, `PROXY_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`

---

### 4. Connecting Your Local CLI to the Cloud Backends

Once deployed, set environment variables to point your CLI to the live services:

```powershell
# PowerShell
$env:MODU_CONTROL_PLANE_URL = "https://your-control-plane.onrender.com"
$env:MODU_PROXY_URL = "https://your-proxy.onrender.com"

# Log in against the cloud control plane:
modu login

# Register an endpoint:
modu register --url https://httpbin.org/get --price 0.01 --asset USDC --path my-api
```

Or on Linux/macOS:

```bash
export MODU_CONTROL_PLANE_URL="https://your-control-plane.onrender.com"
export MODU_PROXY_URL="https://your-proxy.onrender.com"
modu login
```
