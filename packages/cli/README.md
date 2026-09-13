# @ruponchain/modu

> Turn any existing HTTP API endpoint into a pay-per-request endpoint settled with **x402 on Algorand** — with zero payment code written by the developer.

[![npm version](https://img.shields.io/npm/v/@ruponchain/modu.svg)](https://www.npmjs.com/package/@ruponchain/modu)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Algorand](https://img.shields.io/badge/Algorand-x402-000000?logo=algorand&logoColor=white)](https://algorand.co)

---

## Quick Install

Install globally:

```bash
npm install -g @ruponchain/modu
```

Or run instantly without installing:

```bash
npx @ruponchain/modu --help
```

Once installed, the `modu` command is available everywhere in your terminal:

```bash
modu --help
```

---

## Quick Start

### 1. Configure Authentication & Payout Wallet

```bash
modu config
```
Opens your browser to authorize your CLI session, then prompts for your Algorand payout wallet address where all endpoint micropayments settle.

### 2. Monetize Any API Endpoint

```bash
modu register
```
Or pass options directly:
```bash
modu register --url https://httpbin.org/get --price 0.02 --asset USDC --path my-api
```

Output:
```text
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

### 3. Call & Pay with `modu get`

```bash
modu get https://modu-proxy.onrender.com/p/f21408
```
When challenged with `HTTP 402`, `modu` automatically opens a browser page to connect and sign via Lute wallet, then retrieves the paid `200 OK` response.

---

## The x402 Micropayment Protocol

When consumers call your proxy:

1. **Unpaid Request (`HTTP 402`)**:
   ```bash
   curl -i https://modu-proxy.onrender.com/p/f21408
   ```
   Returns an `HTTP 402 Payment Required` challenge containing recipient address, price, and a one-time cryptographic nonce.

2. **Consumer Pays on Algorand**:
   Consumer transfers `0.02 USDC` on Algorand testnet with transaction note `modu:<nonce>`.

3. **Paid Request (`HTTP 200`)**:
   ```bash
   curl -i -H "X-PAYMENT-TXID: <txid>" https://modu-proxy.onrender.com/p/f21408
   ```
   The edge proxy queries the Algorand indexer, verifies the payment, prevents replays, settles revenue into your account, and streams back the origin API response with the `X-PAYMENT-RESPONSE` settlement receipt.

---

## CLI Command Reference

| Command | Description |
| :--- | :--- |
| `modu config [address]` | Configure authentication and Algorand payout destination (`--address`, `--relogin`) |
| `modu register [options]` | Monetize an origin endpoint (`--url`, `--price`, `--asset`, `--path`) or interactive wizard |
| `modu get <url>` / `modu call <url>` | Call an x402 endpoint with automated browser payment via Lute wallet |
| `modu list` | List all registered endpoints, today's volume, and revenue |
| `modu stats <endpointId>` | View detailed revenue summary, daily volume, and top payers |
| `modu logs <endpointId> [--follow]` | View recent request logs or stream live traffic (`-f`, `-n <limit>`) |
| `modu revoke <endpointId>` | Immediately revoke an endpoint (`HTTP 410 Gone`) |
| `modu wallet create` | Generate a fresh Algorand keypair locally (mnemonic shown once) |
| `modu wallet connect <address>` | Set your payout Algorand wallet address |

---

## License

MIT (c) Rupam Ghosh
