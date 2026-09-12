import http from 'node:http';
import readline from 'node:readline';
import chalk from 'chalk';
import open from 'open';
import algosdk from 'algosdk';
import { fromBaseUnits, encodeNote } from '@modu/shared';
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
 * Render the Mac terminal styled payment HTML page
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
  const { url, payTo, amountMicro, humanAmount, assetName, assetId, nonce, network } = params;
  const isAlgo = assetId === '0' || assetName === 'ALGO';
  const encodedNoteStr = encodeURIComponent(`modu:${nonce}`);
  
  // Standard Algorand URI scheme for mobile wallets (Pera, Defly)
  const algorandUri = isAlgo
    ? `algorand://${payTo}?amount=${amountMicro}&note=${encodedNoteStr}`
    : `algorand://${payTo}?amount=${amountMicro}&asset=${assetId}&note=${encodedNoteStr}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    algorandUri
  )}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>modu — x402 payment — 80×24</title>
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
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
    .mac-window {
      width: 680px;
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
      padding: 22px 26px 26px 26px;
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
      margin-bottom: 14px;
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
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.5;
    }
    .session-card {
      background: #111318;
      border: 1px solid #282c34;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 18px;
      font-size: 13px;
    }
    .session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
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
    .tabs-container {
      display: flex;
      gap: 6px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .tab-btn {
      background: #161b22;
      border: 1px solid #30363d;
      color: #8b949e;
      padding: 7px 12px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      background: #21262d;
      color: #c9d1d9;
      border-color: #484f58;
    }
    .tab-btn.active {
      background: #1f2937;
      color: #58a6ff;
      border-color: #58a6ff;
      box-shadow: 0 0 8px rgba(88, 166, 255, 0.25);
    }
    .tab-content {
      display: none;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      animation: fadeIn 0.2s ease;
    }
    .tab-content.active { display: block; }
    .qr-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin: 10px 0;
    }
    .qr-box {
      background: #ffffff;
      padding: 10px;
      border-radius: 8px;
      display: inline-block;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    .qr-box img {
      width: 160px;
      height: 160px;
      display: block;
    }
    .input-shell {
      display: flex;
      align-items: center;
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 0 12px;
      margin-top: 8px;
      margin-bottom: 12px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-shell:focus-within {
      border-color: #58a6ff;
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }
    .input-chevron {
      color: #34d399;
      font-weight: bold;
      font-size: 13px;
      margin-right: 8px;
      user-select: none;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 10px 0;
      background: transparent;
      border: none;
      outline: none;
      color: #f0f6fc;
      font-family: inherit;
      font-size: 13px;
    }
    input::placeholder { color: #484f58; }
    .btn-action {
      width: 100%;
      padding: 10px 16px;
      background: #238636;
      border: 1px solid #2ea043;
      color: #ffffff;
      border-radius: 6px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-action:hover:not(:disabled) {
      background: #2ea043;
      box-shadow: 0 4px 12px rgba(46, 160, 67, 0.35);
    }
    .btn-action:active:not(:disabled) {
      background: #238636;
      transform: translateY(1px);
    }
    .btn-action:disabled { opacity: 0.65; cursor: not-allowed; }
    .btn-secondary {
      background: #21262d;
      border: 1px solid #363b42;
      color: #c9d1d9;
    }
    .btn-secondary:hover:not(:disabled) {
      background: #30363d;
      border-color: #8b949e;
      box-shadow: none;
    }
    .status-msg {
      margin-top: 12px;
      font-size: 12.5px;
      padding: 8px 12px;
      border-radius: 6px;
      display: none;
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
    .wallet-desc {
      font-size: 12.5px;
      color: #8b949e;
      margin-bottom: 12px;
      line-height: 1.45;
    }
    .badge-net {
      background: #232731;
      border: 1px solid #444c56;
      color: #93c5fd;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
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
        <span>modu — x402 payment — 80×24</span>
      </div>
    </div>
    <div class="terminal-body">
      <div class="login-banner">Last login: on ttys003</div>

      <div class="cli-prompt-line">
        <span class="prompt-host">consumer@terminal</span>:<span class="prompt-path">~/modu</span>$ <span class="prompt-cmd">modu get ${url}</span>
      </div>

      <div id="paymentFlow">
        <div class="term-heading">
          <span>⚡</span> Algorand x402 Micropayment
        </div>
        <p class="term-desc">
          HTTP 402 Payment Required. Connect an Algorand wallet or enter testnet credentials to settle and unlock the API response.
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

        <!-- Wallet Selection Tabs -->
        <div class="tabs-container">
          <button class="tab-btn active" onclick="switchTab('pera')">🟡 Pera</button>
          <button class="tab-btn" onclick="switchTab('defly')">🟣 Defly</button>
          <button class="tab-btn" onclick="switchTab('lute')">🟢 Lute</button>
          <button class="tab-btn" onclick="switchTab('kibisis')">🧩 Kibisis</button>
          <button class="tab-btn" onclick="switchTab('testnet')">⚡ Testnet Signer</button>
          <button class="tab-btn" onclick="switchTab('txid')">📋 Paste TxID</button>
        </div>

        <!-- Tab 1: Pera Wallet -->
        <div id="tab-pera" class="tab-content active">
          <p class="wallet-desc">
            Scan with the Pera Wallet mobile app, or click below to launch Pera Wallet with pre-filled payment parameters.
          </p>
          <div class="qr-container">
            <div class="qr-box">
              <img src="${qrCodeUrl}" alt="Pera QR Code" />
            </div>
            <a href="${algorandUri}" class="btn-action" target="_blank" rel="noopener">
              <span>Open in Pera Wallet</span> ↗
            </a>
          </div>
          <div style="margin-top:14px;">
            <p style="font-size:12px; color:#8b949e;">Once confirmed in Pera, paste the transaction ID below:</p>
            <div class="input-shell">
              <span class="input-chevron">❯</span>
              <input type="text" id="peraTxid" placeholder="Paste confirmed Algorand TxID..." spellcheck="false" />
            </div>
            <button class="btn-action btn-secondary" onclick="submitTxid('peraTxid')">Confirm Pera Payment</button>
          </div>
        </div>

        <!-- Tab 2: Defly Wallet -->
        <div id="tab-defly" class="tab-content">
          <p class="wallet-desc">
            Scan with the Defly Wallet app or open on your device to execute the pre-configured micropayment.
          </p>
          <div class="qr-container">
            <div class="qr-box">
              <img src="${qrCodeUrl}" alt="Defly QR Code" />
            </div>
            <a href="${algorandUri}" class="btn-action" target="_blank" rel="noopener">
              <span>Open in Defly Wallet</span> ↗
            </a>
          </div>
          <div style="margin-top:14px;">
            <p style="font-size:12px; color:#8b949e;">Once confirmed in Defly, paste the transaction ID below:</p>
            <div class="input-shell">
              <span class="input-chevron">❯</span>
              <input type="text" id="deflyTxid" placeholder="Paste confirmed Algorand TxID..." spellcheck="false" />
            </div>
            <button class="btn-action btn-secondary" onclick="submitTxid('deflyTxid')">Confirm Defly Payment</button>
          </div>
        </div>

        <!-- Tab 3: Lute Wallet -->
        <div id="tab-lute" class="tab-content">
          <p class="wallet-desc">
            Lute is a web-based Algorand wallet. Open Lute to send <strong>${humanAmount} ${assetName}</strong> to the recipient address with note: <code>modu:${nonce}</code>.
          </p>
          <div style="margin-bottom:14px;">
            <a href="https://lute.app" class="btn-action" target="_blank" rel="noopener">
              <span>Open Lute Wallet (lute.app)</span> ↗
            </a>
          </div>
          <div style="background:#111318; border:1px solid #282c34; border-radius:6px; padding:10px 12px; margin-bottom:14px; font-size:12px;">
            <div style="margin-bottom:4px;"><strong style="color:#79c0ff;">Recipient:</strong> <code style="word-break:break-all;">${payTo}</code></div>
            <div style="margin-bottom:4px;"><strong style="color:#facc15;">Amount:</strong> ${humanAmount} ${assetName}</div>
            <div><strong style="color:#34d399;">Note (Required):</strong> <code>modu:${nonce}</code></div>
          </div>
          <p style="font-size:12px; color:#8b949e;">Once confirmed in Lute, enter the transaction ID:</p>
          <div class="input-shell">
            <span class="input-chevron">❯</span>
            <input type="text" id="luteTxid" placeholder="Paste confirmed Algorand TxID..." spellcheck="false" />
          </div>
          <button class="btn-action btn-secondary" onclick="submitTxid('luteTxid')">Confirm Lute Payment</button>
        </div>

        <!-- Tab 4: Kibisis / Browser Extension -->
        <div id="tab-kibisis" class="tab-content">
          <p class="wallet-desc">
            Connect via standard Algorand browser extension (Kibisis, Defly Web, or compatible ARC-0027 provider).
          </p>
          <button id="extConnectBtn" class="btn-action" onclick="connectBrowserWallet()">
            <span>Connect & Pay with Browser Wallet</span>
          </button>
          <div id="extStatus" class="status-msg"></div>
          <div style="margin-top:14px;">
            <p style="font-size:12px; color:#8b949e;">Or paste transaction ID if signed externally:</p>
            <div class="input-shell">
              <span class="input-chevron">❯</span>
              <input type="text" id="kibisisTxid" placeholder="Paste confirmed Algorand TxID..." spellcheck="false" />
            </div>
            <button class="btn-action btn-secondary" onclick="submitTxid('kibisisTxid')">Confirm Payment</button>
          </div>
        </div>

        <!-- Tab 5: Testnet Mnemonic Signer (Instant) -->
        <div id="tab-testnet" class="tab-content">
          <p class="wallet-desc">
            Developer 1-Click Payment: Enter your 25-word Algorand Testnet mnemonic or secret key. Transaction is signed locally and broadcast to Algorand Testnet node.
          </p>
          <div class="input-shell">
            <span class="input-chevron">❯</span>
            <input type="password" id="mnemonicInput" placeholder="Enter 25-word testnet mnemonic..." autocomplete="off" spellcheck="false" />
          </div>
          <button id="signPayBtn" class="btn-action" onclick="handleSignAndPay()">
            <span>⚡ Sign & Settle ${humanAmount} ${assetName}</span>
          </button>
          <div id="signerStatus" class="status-msg"></div>
        </div>

        <!-- Tab 6: Paste TxID -->
        <div id="tab-txid" class="tab-content">
          <p class="wallet-desc">
            Already submitted payment on Algorand Testnet? Paste your confirmed transaction ID to unlock the endpoint.
          </p>
          <div class="input-shell">
            <span class="input-chevron">❯</span>
            <input type="text" id="manualTxid" placeholder="e.g. 5VHQPKCJJIUYBGV2ZJACAMEFGBFHPATT6JBIWPYVQ7VZD5XLXZDA" spellcheck="false" />
          </div>
          <button class="btn-action" onclick="submitTxid('manualTxid')">
            <span>Submit Payment Proof</span>
          </button>
        </div>

        <div id="globalError" class="status-msg status-error" style="display:none; margin-top:14px;"></div>
      </div>

      <!-- Success Screen -->
      <div id="successScreen" class="term-success">
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>Payment settled on Algorand Testnet!</span>
        </div>
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>x402 challenge verified and confirmed.</span>
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
          Your payment proof has been delivered to your CLI session. Response is now streaming in your terminal. You may close this browser tab.
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
    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.textContent.toLowerCase().includes(tabName));
      if (activeBtn) activeBtn.classList.add('active');
      const activeContent = document.getElementById('tab-' + tabName);
      if (activeContent) activeContent.classList.add('active');
    }

    function showSuccess(txid) {
      document.getElementById('paymentFlow').style.display = 'none';
      document.getElementById('confirmedTxidDisplay').textContent = txid;
      document.getElementById('successScreen').style.display = 'block';
    }

    async function submitTxid(inputId) {
      const input = document.getElementById(inputId);
      const txid = (input ? input.value : '').trim();
      const errDiv = document.getElementById('globalError');
      errDiv.style.display = 'none';

      if (!txid) {
        errDiv.textContent = 'Please enter a valid Algorand transaction ID.';
        errDiv.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showSuccess(txid);
        } else {
          errDiv.textContent = data.error || 'Failed to submit transaction ID';
          errDiv.style.display = 'block';
        }
      } catch (err) {
        errDiv.textContent = 'Error connecting to local modu CLI server.';
        errDiv.style.display = 'block';
      }
    }

    async function handleSignAndPay() {
      const mnemonic = document.getElementById('mnemonicInput').value.trim();
      const btn = document.getElementById('signPayBtn');
      const statusDiv = document.getElementById('signerStatus');
      const errDiv = document.getElementById('globalError');
      errDiv.style.display = 'none';

      if (!mnemonic) {
        errDiv.textContent = 'Please enter your 25-word testnet mnemonic.';
        errDiv.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>Signing & broadcasting transaction...</span>';
      statusDiv.textContent = 'Connecting to Algorand Testnet node...';
      statusDiv.className = 'status-msg status-info';

      try {
        const res = await fetch('/api/sign-and-pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mnemonic })
        });
        const data = await res.json();

        if (res.ok && data.success && data.txId) {
          statusDiv.textContent = 'Confirmed on testnet! TxID: ' + data.txId;
          showSuccess(data.txId);
        } else {
          btn.disabled = false;
          btn.innerHTML = '<span>⚡ Sign & Settle ${humanAmount} ${assetName}</span>';
          statusDiv.textContent = 'Error: ' + (data.error || 'Transaction failed');
          statusDiv.className = 'status-msg status-error';
        }
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ Sign & Settle ${humanAmount} ${assetName}</span>';
        statusDiv.textContent = 'Network error communicating with local CLI server.';
        statusDiv.className = 'status-msg status-error';
      }
    }

    async function connectBrowserWallet() {
      const statusDiv = document.getElementById('extStatus');
      statusDiv.style.display = 'block';
      statusDiv.className = 'status-msg status-info';

      if (!window.algorand) {
        statusDiv.textContent = 'No Algorand extension (Kibisis, Defly) detected. Use Pera, Lute, or the Testnet Signer.';
        statusDiv.className = 'status-msg status-error';
        return;
      }

      try {
        statusDiv.textContent = 'Requesting account authorization from browser wallet...';
        const accounts = await window.algorand.enable();
        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts authorized');
        }
        const sender = accounts[0].address || accounts[0];
        statusDiv.textContent = 'Connected: ' + sender.slice(0, 8) + '... Please confirm transaction in your wallet.';
        
        // Let user know to submit txid or if provider supports signing
        statusDiv.textContent = 'Connected! Please sign the payment with note: modu:${nonce} and enter the TxID below.';
      } catch (err) {
        statusDiv.textContent = err.message || 'Browser wallet connection failed';
        statusDiv.className = 'status-msg status-error';
      }
    }
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

    if (pathname === '/api/sign-and-pay' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const mnemonic = parsed.mnemonic?.trim();
          if (!mnemonic) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Mnemonic is required' }));
            return;
          }

          const account = algosdk.mnemonicToSecretKey(mnemonic);
          const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
          const params = await algodClient.getTransactionParams().do();
          const noteBytes = encodeNote(nonce);

          let txn: algosdk.Transaction;
          if (isAlgo) {
            txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: account.addr,
              to: payTo,
              amount: BigInt(amountMicro),
              note: noteBytes,
              suggestedParams: params,
            });
          } else {
            txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: account.addr,
              to: payTo,
              assetIndex: Number(assetId),
              amount: BigInt(amountMicro),
              note: noteBytes,
              suggestedParams: params,
            });
          }

          const signedTxn = txn.signTxn(account.sk);
          const sendRes = await algodClient.sendRawTransaction(signedTxn).do();
          const txId = sendRes.txId || sendRes.txid;

          // Wait for confirmation on Algorand testnet
          await algosdk.waitForConfirmation(algodClient, txId, 5);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, txId }));

          txidPromiseResolve(txId);
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Transaction signing failed' }));
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
  console.log(chalk.bold.cyan('\n⚡ Settle Micropayment to Proceed'));
  console.log(`${chalk.bold('Amount:')}      ${chalk.yellow(`${humanAmount} ${assetName}`)}`);
  console.log(`${chalk.bold('Recipient:')}   ${chalk.green(payTo)}`);
  console.log(`${chalk.bold('Nonce:')}       ${chalk.dim(nonce)}`);
  console.log(`${chalk.bold('Network:')}     ${chalk.dim(network)}`);
  console.log(`\nOpening browser for wallet payment: ${chalk.underline.blue(payUrl)}`);

  // Open browser unless disabled (e.g. in headless tests)
  if (options.autoOpen !== false) {
    try {
      await open(payUrl);
    } catch {
      console.log(chalk.yellow(`Could not open browser automatically. Please visit:\n${payUrl}`));
    }
  }

  process.stdout.write(
    chalk.dim('Waiting for payment in browser (or paste confirmed Algorand TxID here)... ')
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
