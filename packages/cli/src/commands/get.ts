import http from 'node:http';
import readline from 'node:readline';
import chalk from 'chalk';
import open from 'open';
import algosdk from 'algosdk';
import { fromBaseUnits, encodeNote } from '../shared.js';
import { logInfo, logWarn, logError } from '../logger.js';

export interface GetOptions {
  headers?: string[];
  txid?: string;
  autoOpen?: boolean;
  json?: boolean;
  timeoutMs?: number;
}

interface X402Accept {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  nonce?: string;
}

interface X402Challenge {
  x402Version?: number;
  accepts?: X402Accept[];
}

/**
 * Format an HTTP response to match curl -i output:
 * Status line + headers + blank line + body
 */
export function formatHttpResponse(res: Response, bodyText: string): string {
  const httpVersion = 'HTTP/1.1';
  let defaultStatusText = '';
  if (res.status === 200) defaultStatusText = 'OK';
  else if (res.status === 402) defaultStatusText = 'Payment Required';
  else if (res.status === 404) defaultStatusText = 'Not Found';
  else if (res.status === 410) defaultStatusText = 'Gone';
  else if (res.status === 500) defaultStatusText = 'Internal Server Error';

  const statusText = res.statusText || defaultStatusText;
  const statusLine = `${httpVersion} ${res.status} ${statusText}`.trim();

  const headerLines: string[] = [];
  res.headers.forEach((value, name) => {
    headerLines.push(`${name}: ${value}`);
  });

  let formattedBody = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    if (res.status === 200) {
      formattedBody = JSON.stringify(parsed, null, 2);
    } else {
      formattedBody = JSON.stringify(parsed);
    }
  } catch {
    formattedBody = bodyText;
  }

  return `${statusLine}\n${headerLines.join('\n')}\n\n${formattedBody}`;
}

/**
 * Render the Mac terminal styled Lute-only payment HTML page
 */
export function renderPaymentPage(params: {
  url: string;
  payTo: string;
  amountMicro: string;
  humanAmount: string;
  assetName: string;
  assetId: string;
  nonce: string;
  network: string;
}): string {
  const { url, payTo, humanAmount, assetName, nonce, network } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>modu — Lute Payment Approval — 80×24</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(56, 73, 107, 0.35), transparent 70%),
                  radial-gradient(circle at 15% 85%, rgba(35, 45, 75, 0.2), transparent 50%),
                  #0a0c10;
      color: #c9d1d9;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .mac-window {
      width: 620px;
      max-width: 100%;
      background: rgba(22, 24, 29, 0.96);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 
        0 28px 70px -10px rgba(0, 0, 0, 0.8),
        0 14px 32px -8px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.07);
      overflow: hidden;
      backdrop-filter: blur(25px);
      -webkit-backdrop-filter: blur(25px);
      animation: windowAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes windowAppear {
      from { opacity: 0; transform: scale(0.98) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .window-titlebar {
      height: 38px;
      background: linear-gradient(180deg, #37373f 0%, #292830 100%);
      border-bottom: 1px solid rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      position: relative;
      user-select: none;
      padding: 0 14px;
    }
    .traffic-lights {
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 2;
    }
    .traffic-btn {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }
    .btn-close { background: #ff5f56; border: 0.5px solid #e0443e; }
    .btn-minimize { background: #ffbd2e; border: 0.5px solid #dea123; }
    .btn-zoom { background: #27c93f; border: 0.5px solid #1aab29; }
    .titlebar-center {
      position: absolute;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #9d9ea7;
      letter-spacing: 0.2px;
      pointer-events: none;
    }
    .terminal-body {
      padding: 24px 28px 28px 28px;
      font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 13.5px;
      line-height: 1.65;
      color: #d1d5db;
    }
    .login-banner {
      color: #6b7280;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .cli-prompt-line {
      margin-bottom: 16px;
      font-size: 13.5px;
      word-break: break-all;
    }
    .prompt-host { color: #34d399; font-weight: 600; }
    .prompt-path { color: #60a5fa; font-weight: 600; }
    .prompt-cmd { color: #f3f4f6; }
    .term-heading {
      font-size: 18px;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .term-desc {
      color: #9ca3af;
      margin-bottom: 18px;
      font-size: 13px;
      line-height: 1.5;
    }
    .session-card {
      background: #111318;
      border: 1px solid #282c34;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .session-row:last-child { margin-bottom: 0; }
    .session-label { color: #8b949e; }
    .session-value { color: #f0f6fc; font-weight: 500; word-break: break-all; }
    .token-badge {
      background: #1e2430;
      border: 1px solid #384357;
      color: #79c0ff;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .price-badge {
      background: rgba(234, 179, 8, 0.15);
      border: 1px solid rgba(234, 179, 8, 0.4);
      color: #facc15;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-net {
      background: #232731;
      border: 1px solid #444c56;
      color: #93c5fd;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    .lute-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .lute-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .lute-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #238636;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .lute-title {
      font-size: 15px;
      font-weight: 600;
      color: #f0f6fc;
    }
    .lute-subtitle {
      font-size: 12.5px;
      color: #8b949e;
    }
    .btn-action {
      width: 100%;
      padding: 13px 18px;
      background: #238636;
      border: 1px solid #2ea043;
      color: #ffffff;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: all 0.15s ease;
      text-decoration: none;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .btn-action:hover:not(:disabled) {
      background: #2ea043;
      box-shadow: 0 4px 14px rgba(46, 160, 67, 0.4);
    }
    .btn-action:active:not(:disabled) {
      background: #238636;
      transform: translateY(1px);
    }
    .btn-action:disabled { opacity: 0.65; cursor: not-allowed; }
    .status-msg {
      font-size: 12.5px;
      padding: 10px 14px;
      border-radius: 6px;
      display: none;
      line-height: 1.45;
    }
    .status-info {
      background: rgba(56, 139, 253, 0.12);
      border: 1px solid rgba(56, 139, 253, 0.4);
      color: #79c0ff;
      display: block;
    }
    .status-error {
      background: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: #ff7b72;
      display: block;
    }
    .term-success {
      display: none;
      padding: 10px 0;
      animation: fadeIn 0.3s ease;
    }
    .success-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 14px;
      color: #e6edf3;
    }
    .success-check { color: #3fb950; font-weight: bold; }
    .success-dim {
      color: #8b949e;
      font-size: 13px;
      margin-top: 14px;
      line-height: 1.5;
    }
    .process-done {
      color: #6b7280;
      font-size: 12.5px;
      margin-top: 14px;
      margin-bottom: 12px;
    }
    .return-prompt {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13.5px;
    }
    .cursor-block {
      display: inline-block;
      width: 8px;
      height: 15px;
      background: #58a6ff;
      animation: cursorBlink 1s infinite;
      vertical-align: middle;
      margin-left: 2px;
    }
    @keyframes cursorBlink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="mac-window">
    <div class="window-titlebar">
      <div class="traffic-lights">
        <span class="traffic-btn btn-close"></span>
        <span class="traffic-btn btn-minimize"></span>
        <span class="traffic-btn btn-zoom"></span>
      </div>
      <div class="titlebar-center">
        <span>modu — Lute Payment Approval — 80×24</span>
      </div>
    </div>
    <div class="terminal-body">
      <div class="login-banner">Last login: on ttys003</div>

      <div class="cli-prompt-line">
        <span class="prompt-host">consumer@terminal</span>:<span class="prompt-path">~/modu</span>$ <span class="prompt-cmd">modu get ${url}</span>
      </div>

      <div id="paymentFlow">
        <div class="term-heading">
          <span>⚡</span> Algorand x402 Payment (Lute)
        </div>
        <p class="term-desc">
          HTTP 402 Payment Required. Connect your Lute wallet to approve and sign the micropayment.
        </p>

        <div class="session-card">
          <div class="session-row">
            <span class="session-label">Resource:</span>
            <span class="session-value" style="font-size:12px;">${url}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Amount Required:</span>
            <span class="price-badge">${humanAmount} ${assetName}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Payout Recipient:</span>
            <span class="token-badge" title="${payTo}">${payTo.slice(0, 10)}...${payTo.slice(-8)}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Challenge Nonce:</span>
            <span class="token-badge">${nonce.slice(0, 12)}...</span>
          </div>
          <div class="session-row">
            <span class="session-label">Network:</span>
            <span class="badge-net">${network}</span>
          </div>
        </div>

        <div class="lute-card">
          <div class="lute-header">
            <div class="lute-icon">🟢</div>
            <div>
              <div class="lute-title">Lute Wallet</div>
              <div class="lute-subtitle">Connect your Lute wallet to prompt and sign this transaction</div>
            </div>
          </div>

          <div id="accountCard" style="display:none; background:#111318; border:1px solid #282c34; border-radius:6px; padding:10px 12px; font-size:12.5px;">
            <span style="color:#8b949e;">Connected Account: </span>
            <span id="connectedAccountDisplay" style="color:#34d399; font-weight:500;">-</span>
          </div>

          <button id="luteBtn" class="btn-action">
            <span>Connect Lute Wallet</span>
          </button>

          <div id="statusMsg" class="status-msg"></div>
        </div>
      </div>

      <!-- Success Screen -->
      <div id="successScreen" class="term-success">
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>Payment approved and signed in Lute!</span>
        </div>
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>Transaction confirmed on Algorand Testnet.</span>
        </div>
        <div class="session-card" style="margin-top:14px;">
          <div class="session-row">
            <span class="session-label">Transaction ID:</span>
            <span class="token-badge" id="confirmedTxidDisplay">-</span>
          </div>
          <div class="session-row">
            <span class="session-label">Amount Paid:</span>
            <span class="price-badge">${humanAmount} ${assetName}</span>
          </div>
        </div>
        <div class="success-dim">
          Payment confirmed. Response is now streaming in your terminal. You may close this tab.
        </div>
        <div class="process-done">
          [Process completed]
        </div>
        <div class="return-prompt">
          <span class="prompt-host">consumer@terminal</span>:<span class="prompt-path">~/modu</span>$ <span class="cursor-block"></span>
        </div>
      </div>

    </div>
  </div>

  <script>
    // Embedded LuteConnect client
    const PARAMS = "width=500,height=750,left=" + (100 + window.screenX) + ",top=" + (100 + window.screenY);
    const BASE_URL = "https://lute.app";

    class LuteConnect {
      constructor(siteName) {
        this.siteName = siteName || document.title || "modu";
        this.forceWeb = false;
      }

      connect(genesisID) {
        return new Promise((resolve, reject) => {
          const useExt = this.forceWeb ? false : !!window.lute;
          let win;
          if (useExt) {
            window.dispatchEvent(new CustomEvent("lute-connect", {
              detail: { action: "connect", genesisID }
            }));
          } else {
            win = window.open(BASE_URL + "/connect", this.siteName, PARAMS);
          }
          const type = useExt ? "connect-response" : "message";

          function messageHandler(event) {
            if (!useExt && event.origin !== "https://lute.app") return;
            const data = event.data || event.detail;
            if (!data) return;
            switch (data.action) {
              case "ready":
                win?.postMessage({ action: "network", genesisID }, "*");
                break;
              case "connect":
                window.removeEventListener(type, messageHandler);
                resolve(data.addrs);
                break;
              case "error":
                window.removeEventListener(type, messageHandler);
                reject(new Error(data.message));
                break;
              case "close":
                window.removeEventListener(type, messageHandler);
                reject(new Error("Operation Cancelled"));
                break;
            }
          }
          window.addEventListener(type, messageHandler);
        });
      }

      signTxns(txns) {
        return new Promise((resolve, reject) => {
          const useExt = this.forceWeb ? false : !!window.lute;
          let win;
          if (useExt) {
            window.dispatchEvent(new CustomEvent("lute-connect", {
              detail: { action: "sign", txns }
            }));
          } else {
            win = window.open(BASE_URL + "/sign", this.siteName, PARAMS);
          }
          const type = useExt ? "sign-txns-response" : "message";

          function messageHandler(event) {
            if (!useExt && event.origin !== "https://lute.app") return;
            const detail = event.data || event.detail;
            if (!detail) return;
            switch (detail.action) {
              case "ready":
                win?.postMessage({ action: "sign", txns }, "*");
                break;
              case "signed":
                window.removeEventListener(type, messageHandler);
                resolve(detail.txns);
                break;
              case "error":
                window.removeEventListener(type, messageHandler);
                reject(new Error(detail.message || "Signing failed"));
                break;
              case "close":
                window.removeEventListener(type, messageHandler);
                reject(new Error("User Rejected Request"));
                break;
            }
          }
          window.addEventListener(type, messageHandler);
        });
      }
    }

    // Two-step state machine:
    //   STEP 1 click → lute.connect() fires window.open() synchronously ✓
    //   After connect: fetch prepared txn in background, store it
    //   STEP 2 click → lute.signTxns() fires window.open() synchronously ✓
    // Both window.open() calls happen as the FIRST async operation inside a
    // Promise constructor, directly triggered by a user click — so browsers
    // never block them.

    const lute = new LuteConnect("modu");
    let activeAccount = null;
    let preparedTxnB64 = null;  // stored after step 1 so step 2 can sign immediately

    const btn = document.getElementById('luteBtn');
    const statusDiv = document.getElementById('statusMsg');

    function setStatus(msg, isError) {
      statusDiv.style.display = 'block';
      statusDiv.className = 'status-msg ' + (isError ? 'status-error' : 'status-info');
      statusDiv.textContent = msg;
    }

    function showSuccess(txid) {
      document.getElementById('paymentFlow').style.display = 'none';
      document.getElementById('confirmedTxidDisplay').textContent = txid;
      document.getElementById('successScreen').style.display = 'block';
    }

    // ── STEP 1: connect ─────────────────────────────────────────────────────
    // Called synchronously from button click.
    // lute.connect() fires window.open() inside its Promise constructor —
    // still within the user-gesture stack frame.
    function step1Connect() {
      btn.disabled = true;
      btn.innerHTML = '<span>Connecting to Lute…</span>';
      setStatus('Opening Lute — please connect your wallet in the popup…', false);

      // connectPromise is created synchronously (window.open fires NOW)
      const connectPromise = lute.connect('testnet-v1.0');

      connectPromise.then(async (addrs) => {
        if (!addrs || addrs.length === 0) throw new Error('No accounts selected in Lute');
        activeAccount = addrs[0];

        document.getElementById('connectedAccountDisplay').textContent =
          activeAccount.slice(0, 10) + '…' + activeAccount.slice(-8);
        document.getElementById('accountCard').style.display = 'block';
        setStatus('Connected ✓  Fetching transaction details…', false);
        btn.innerHTML = '<span>Fetching transaction…</span>';

        // Fetch the unsigned txn in the background while user waits
        const prepRes = await fetch('/api/prepare-txn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: activeAccount })
        });
        const prepData = await prepRes.json();
        if (!prepRes.ok || !prepData.txn) throw new Error(prepData.error || 'Failed to prepare transaction');
        preparedTxnB64 = prepData.txn;

        // Transition to step 2 — rewire the button
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ Sign & Pay ${humanAmount} ${assetName} in Lute</span>';
        btn.onclick = step2Sign;
        setStatus('Ready to pay. Click the button to open Lute and sign the transaction.', false);

      }).catch((err) => {
        btn.disabled = false;
        btn.innerHTML = '<span>Connect Lute Wallet</span>';
        setStatus('Error: ' + (err.message || 'Connect failed'), true);
      });
    }

    // ── STEP 2: sign ────────────────────────────────────────────────────────
    // Called synchronously from the "Sign & Pay" button click.
    // lute.signTxns() fires window.open() inside its Promise constructor —
    // still within the user-gesture stack frame.
    function step2Sign() {
      if (!preparedTxnB64) {
        setStatus('Transaction not ready yet, please wait…', true);
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span>Signing in Lute…</span>';
      setStatus('Opening Lute — please approve the transaction in the popup…', false);

      // signPromise is created synchronously (window.open fires NOW)
      const signPromise = lute.signTxns([{ txn: preparedTxnB64 }]);

      signPromise.then(async (signedTxns) => {
        if (!signedTxns || !signedTxns[0]) throw new Error('Transaction was not signed in Lute');

        btn.innerHTML = '<span>Broadcasting…</span>';
        setStatus('Transaction signed ✓  Broadcasting to Algorand Testnet…', false);

        const broadcastRes = await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedTxn: Array.from(signedTxns[0]) })
        });
        const broadcastData = await broadcastRes.json();
        if (!broadcastRes.ok || !broadcastData.txId) throw new Error(broadcastData.error || 'Broadcast failed');

        setStatus('Confirmed on Testnet ✓  TxID: ' + broadcastData.txId, false);
        showSuccess(broadcastData.txId);

      }).catch((err) => {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ Sign & Pay ${humanAmount} ${assetName} in Lute</span>';
        setStatus('Error: ' + (err.message || 'Sign failed'), true);
      });
    }

    // Wire initial click to step 1
    btn.onclick = step1Connect;
  </script>
</body>
</html>`;
}

/**
 * Handle execution of the unified modu get command
 */
export async function getCommand(url: string, options: GetOptions = {}): Promise<void> {
  if (!url) {
    const msg = 'Target URL is required: modu get <url>';
    logError('GET', msg);
    if (options.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(chalk.red(`Error: ${msg}`));
    }
    process.exitCode = 1;
    return;
  }

  // Parse custom headers passed with -H
  const reqHeaders: Record<string, string> = {};
  if (options.headers && Array.isArray(options.headers)) {
    for (const h of options.headers) {
      const idx = h.indexOf(':');
      if (idx > 0) {
        const key = h.slice(0, idx).trim();
        const val = h.slice(idx + 1).trim();
        reqHeaders[key] = val;
      }
    }
  }

  // If user provided a txid up-front, send with X-PAYMENT-TXID directly
  if (options.txid) {
    reqHeaders['X-PAYMENT-TXID'] = options.txid.trim();
  }

  logInfo('GET', 'Executing request', { url, headers: reqHeaders });

  let initialRes: Response;
  let bodyText: string;
  try {
    initialRes = await fetch(url, {
      method: 'GET',
      headers: reqHeaders,
    });
    bodyText = await initialRes.text();
  } catch (err: any) {
    logError('GET', 'Failed to fetch target URL', err);
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error fetching ${url}: ${err.message}`));
    }
    process.exitCode = 1;
    return;
  }

  // Output response formatted like curl -i
  const formattedFirstRes = formatHttpResponse(initialRes, bodyText);
  console.log(formattedFirstRes);

  // If response is not 402, we are done
  if (initialRes.status !== 402) {
    return;
  }

  // Parse x402 challenge
  let challenge: X402Challenge | null = null;
  try {
    challenge = JSON.parse(bodyText);
  } catch {
    challenge = null;
  }

  const accept = challenge?.accepts?.[0];
  if (!accept || !accept.payTo || !accept.nonce) {
    logWarn('GET', 'Response 402 was not a valid x402 challenge');
    return;
  }

  const payTo = accept.payTo;
  const nonce = accept.nonce;
  const assetId = accept.asset || '0';
  const amountMicro = accept.maxAmountRequired || '0';
  const network = accept.network || 'algorand-testnet';
  const isAlgo = assetId === '0' || assetId === 'ALGO';
  const assetName = isAlgo ? 'ALGO' : 'USDC';
  const decimals = 6;
  const humanAmount = fromBaseUnits(amountMicro, decimals);

  logInfo('GET', 'x402 challenge parsed', {
    payTo,
    nonce,
    asset: assetName,
    amount: humanAmount,
    amountMicro,
    network,
  });

  // Start local HTTP payment server on ephemeral port
  let server: http.Server;
  let txidPromiseResolve: (txid: string) => void;
  let txidPromiseReject: (err: Error) => void;
  const txidPromise = new Promise<string>((resolve, reject) => {
    txidPromiseResolve = resolve;
    txidPromiseReject = reject;
  });

  server = http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    const parsedUrl = new URL(reqUrl, 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    // CORS headers for local page interactions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/pay') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        renderPaymentPage({
          url,
          payTo,
          amountMicro,
          humanAmount,
          assetName,
          assetId,
          nonce,
          network,
        })
      );
      return;
    }

    if (pathname === '/api/prepare-txn' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const sender = parsed.from?.trim();
          if (!sender || !algosdk.isValidAddress(sender)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Valid sender Algorand address is required' }));
            return;
          }

          const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
          const params = await algodClient.getTransactionParams().do();
          const noteBytes = encodeNote(nonce);

          let txn: algosdk.Transaction;
          if (isAlgo) {
            txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: sender,
              to: payTo,
              amount: BigInt(amountMicro),
              note: noteBytes,
              suggestedParams: params,
            });
          } else {
            txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: sender,
              to: payTo,
              assetIndex: Number(assetId),
              amount: BigInt(amountMicro),
              note: noteBytes,
              suggestedParams: params,
            });
          }

          const txnBase64 = Buffer.from(txn.toByte()).toString('base64');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, txn: txnBase64 }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Failed to prepare transaction' }));
        }
      });
      return;
    }

    if (pathname === '/api/broadcast' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          let signedBytes: Uint8Array;
          if (Array.isArray(parsed.signedTxn)) {
            signedBytes = new Uint8Array(parsed.signedTxn);
          } else if (typeof parsed.signedTxn === 'string') {
            signedBytes = Buffer.from(parsed.signedTxn, 'base64');
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Signed transaction is required' }));
            return;
          }

          const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
          const sendRes = await algodClient.sendRawTransaction(signedBytes).do();
          const txId = sendRes.txId || sendRes.txid;

          // Wait for confirmation on Algorand testnet
          await algosdk.waitForConfirmation(algodClient, txId, 5);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, txId }));

          txidPromiseResolve(txId);
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Transaction broadcast failed' }));
        }
      });
      return;
    }

    if (pathname === '/api/complete' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.txid || typeof parsed.txid !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid txid' }));
            return;
          }
          const cleanTxid = parsed.txid.trim();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, txId: cleanTxid }));
          txidPromiseResolve(cleanTxid);
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid JSON body' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Listen on ephemeral local port
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addressInfo = server.address() as any;
  const port = addressInfo.port;
  const payUrl = `http://127.0.0.1:${port}/pay`;

  logInfo('GET', 'Payment server listening', { port, payUrl });

  // Terminal prompt and status
  console.log(chalk.bold.cyan('\n⚡ Settle Micropayment via Lute Wallet'));
  console.log(`${chalk.bold('Amount:')}      ${chalk.yellow(`${humanAmount} ${assetName}`)}`);
  console.log(`${chalk.bold('Recipient:')}   ${chalk.green(payTo)}`);
  console.log(`${chalk.bold('Nonce:')}       ${chalk.dim(nonce)}`);
  console.log(`${chalk.bold('Network:')}     ${chalk.dim(network)}`);
  console.log(`\nOpening browser for Lute payment approval: ${chalk.underline.blue(payUrl)}`);

  // Open browser unless disabled (e.g. in headless tests)
  if (options.autoOpen !== false) {
    try {
      await open(payUrl);
    } catch {
      console.log(chalk.yellow(`Could not open browser automatically. Please visit:\n${payUrl}`));
    }
  }

  process.stdout.write(
    chalk.dim('Waiting for payment approval in Lute (or paste confirmed Algorand TxID here)... ')
  );

  // Setup stdin readline for manual TxID paste in terminal if running interactively
  let rl: readline.Interface | undefined;
  if (process.stdin.isTTY) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on('line', line => {
      const trimmed = line.trim();
      if (trimmed.length >= 40) {
        txidPromiseResolve(trimmed);
      }
    });
  }

  // Set timeout fallback (default 5 minutes)
  const maxTimeoutMs = options.timeoutMs || 300_000;
  const timeoutId = setTimeout(() => {
    txidPromiseReject(new Error('Payment wait timed out after 5 minutes.'));
  }, maxTimeoutMs);

  let confirmedTxid: string;
  try {
    confirmedTxid = await txidPromise;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (rl) rl.close();
    server.close();
    console.error(chalk.red(`\nPayment aborted: ${err.message}`));
    process.exitCode = 1;
    return;
  } finally {
    clearTimeout(timeoutId);
    if (rl) rl.close();
    server.close();
  }

  logInfo('GET', 'Payment confirmed', { txid: confirmedTxid });

  // Allow indexer a brief moment to synchronize
  await new Promise(r => setTimeout(r, 1200));

  // Re-request origin proxy endpoint with X-PAYMENT-TXID
  const paidHeaders = {
    ...reqHeaders,
    'X-PAYMENT-TXID': confirmedTxid,
  };

  let paidRes: Response;
  let paidBody: string;
  try {
    paidRes = await fetch(url, {
      method: 'GET',
      headers: paidHeaders,
    });
    paidBody = await paidRes.text();
  } catch (err: any) {
    logError('GET', 'Failed to retrieve paid response', err);
    console.error(chalk.red(`Error retrieving response with payment proof: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  console.log('\n' + formatHttpResponse(paidRes, paidBody));
}
