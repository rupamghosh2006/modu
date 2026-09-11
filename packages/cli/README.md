# @ruponchain/modu

> Turn any existing HTTP API endpoint into a pay-per-request endpoint settled with **x402 on Algorand** — with zero payment code written by the developer.

[![npm version](https://img.shields.io/npm/v/@ruponchain/modu.svg)](https://www.npmjs.com/package/@ruponchain/modu)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ⚡ Quick Install

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

## 🚀 Quick Start

### 1. Authenticate

```bash
modu login
```
Opens your browser to authorize your CLI session. Saves an API key locally to `~/.modu/config.json`.

### 2. Connect Your Algorand Payout Wallet

```bash
modu wallet connect <YOUR_ALGORAND_ADDRESS>
```
Or create a fresh wallet locally (key generated client-side and never stored):
```bash
modu wallet create
```

### 3. Monetize Any API Endpoint

```bash
modu register --url https://api.my-service.com/v1/data --price 0.01 --asset USDC --path my-data
```

Output:
```text
⚡ Endpoint Registered Successfully!

Endpoint ID:    927ed2a5
Proxy URL:      https://modu-proxy.onrender.com/p/my-data
Origin URL:     https://api.my-service.com/v1/data
Price:          0.01 USDC
Payout To:      YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A
```

---

## 📡 The x402 Micropayment Protocol

When consumers call your proxy:

1. **Unpaid Request (`HTTP 402`)**:
   ```bash
   curl -i https://modu-proxy.onrender.com/p/my-data
   ```
   Returns an `HTTP 402 Payment Required` challenge containing recipient address, price, and a one-time cryptographic nonce.

2. **Consumer Pays on Algorand**:
   Consumer transfers `0.01 USDC` on Algorand testnet with transaction note `modu:<nonce>`.

3. **Paid Request (`HTTP 200`)**:
   ```bash
   curl -i -H "X-PAYMENT-TXID: <txid>" https://modu-proxy.onrender.com/p/my-data
   ```
   The edge proxy queries the Algorand indexer, verifies the payment, prevents replays, settles revenue into your account, and streams back the origin API response with the `X-PAYMENT-RESPONSE` settlement receipt.

---

## 💻 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `modu login` | Authenticate CLI with your developer account via browser |
| `modu wallet create` | Generate a new Algorand keypair locally |
| `modu wallet connect <address>` | Set your payout Algorand wallet address |
| `modu register [options]` | Monetize an origin endpoint (`--url`, `--price`, `--asset`, `--path`) |
| `modu list` | List all registered endpoints, today's volume, and revenue |
| `modu stats <endpointId>` | View detailed revenue summary, daily volume, and top payers |
| `modu logs <endpointId> [--follow]` | View recent request logs or stream live traffic |
| `modu revoke <endpointId>` | Immediately revoke an endpoint (`HTTP 410 Gone`) |

---

## 📄 License

MIT © Rupam Ghosh
