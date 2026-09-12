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
  // Entire script wrapped in IIFE so MetaMask/SES lockdown cannot conflict
  // with our const/class declarations at the top-level global scope.
  (function() {
    'use strict';

    // ─── LuteConnect (embedded) ────────────────────────────────────────────
    var BASE_URL = "https://lute.app";

    function getPopupParams() {
      return "width=500,height=750,left=" + (Math.round(window.screenX) + 100) +
             ",top=" + (Math.round(window.screenY) + 100);
    }

    function LuteConnect(siteName) {
      this.siteName = siteName || "modu";
    }

    LuteConnect.prototype.connect = function(genesisID) {
      var self = this;
      return new Promise(function(resolve, reject) {
        if (window.lute) {
          window.dispatchEvent(new CustomEvent("lute-connect", {
            detail: { action: "connect", genesisID: genesisID }
          }));
          function extHandler(e) {
            window.removeEventListener("connect-response", extHandler);
            var d = e.detail;
            if (!d) return reject(new Error("No response from Lute extension"));
            if (d.action === "connect") resolve(d.addrs);
            else if (d.action === "error") reject(new Error(d.message));
            else if (d.action === "close") reject(new Error("Operation Cancelled"));
          }
          window.addEventListener("connect-response", extHandler);
          return;
        }
        var win = window.open(BASE_URL + "/connect", self.siteName, getPopupParams());
        if (!win || win.closed || typeof win.closed === "undefined") {
          return reject(new Error("POPUP_BLOCKED"));
        }
        function popupHandler(event) {
          if (event.origin !== "https://lute.app") return;
          var data = event.data;
          if (!data) return;
          if (data.action === "ready") {
            win.postMessage({ action: "network", genesisID: genesisID }, "*");
          } else if (data.action === "connect") {
            window.removeEventListener("message", popupHandler);
            resolve(data.addrs);
          } else if (data.action === "error") {
            window.removeEventListener("message", popupHandler);
            reject(new Error(data.message));
          } else if (data.action === "close") {
            window.removeEventListener("message", popupHandler);
            reject(new Error("Operation Cancelled"));
          }
        }
        window.addEventListener("message", popupHandler);
      });
    };

    LuteConnect.prototype.signTxns = function(txns) {
      var self = this;
      return new Promise(function(resolve, reject) {
        if (window.lute) {
          window.dispatchEvent(new CustomEvent("lute-connect", {
            detail: { action: "sign", txns: txns }
          }));
          function extHandler(e) {
            window.removeEventListener("sign-txns-response", extHandler);
            var d = e.detail;
            if (!d) return reject(new Error("No response from Lute extension"));
            if (d.action === "signed") resolve(d.txns);
            else if (d.action === "error") reject(new Error(d.message || "Signing failed"));
            else if (d.action === "close") reject(new Error("User Rejected Request"));
          }
          window.addEventListener("sign-txns-response", extHandler);
          return;
        }
        var win = window.open(BASE_URL + "/sign", self.siteName, getPopupParams());
        if (!win || win.closed || typeof win.closed === "undefined") {
          return reject(new Error("POPUP_BLOCKED"));
        }
        function popupHandler(event) {
          if (event.origin !== "https://lute.app") return;
          var detail = event.data;
          if (!detail) return;
          if (detail.action === "ready") {
            win.postMessage({ action: "sign", txns: txns }, "*");
          } else if (detail.action === "signed") {
            window.removeEventListener("message", popupHandler);
            resolve(detail.txns);
          } else if (detail.action === "error") {
            window.removeEventListener("message", popupHandler);
            reject(new Error(detail.message || "Signing failed"));
          } else if (detail.action === "close") {
            window.removeEventListener("message", popupHandler);
            reject(new Error("User Rejected Request"));
          }
        }
        window.addEventListener("message", popupHandler);
      });
    };

    // ─── UI helpers ──────────────────────────────────────────────────────────
    function getEl(id) { return document.getElementById(id); }

    function setStatus(msg, isError) {
      var d = getEl("statusMsg");
      d.style.display = "block";
      d.className = "status-msg " + (isError ? "status-error" : "status-info");
      d.textContent = msg;
    }

    function showSuccess(txid) {
      getEl("paymentFlow").style.display = "none";
      getEl("confirmedTxidDisplay").textContent = txid;
      getEl("successScreen").style.display = "block";
    }

    function showPopupBlockedWarning(retryFnName) {
      var d = getEl("statusMsg");
      d.style.display = "block";
      d.className = "status-msg status-error";
      d.innerHTML =
        "<strong>Popup blocked by browser.</strong><br>" +
        "Click the <strong>popup blocked icon</strong> in Chrome\u2019s address bar " +
        "and choose <em>Always allow popups from 127.0.0.1</em>, " +
        "then click <strong>Retry</strong>.<br><br>" +
        "<button onclick=\"window." + retryFnName + "()\" " +
        "style=\"padding:6px 14px;background:#238636;color:#fff;" +
        "border:1px solid #2ea043;border-radius:4px;cursor:pointer;font-size:13px;\">" +
        "Retry</button>";
    }

    // ─── State ───────────────────────────────────────────────────────────────
    var lute = new LuteConnect("modu");
    var activeAccount = null;
    var preparedTxnB64 = null;

    // ─── STEP 1: connect ─────────────────────────────────────────────────────
    function step1Connect() {
      var btn = getEl("luteBtn");
      btn.disabled = true;
      btn.textContent = "Connecting to Lute\u2026";
      setStatus("Opening Lute wallet\u2026 approve the popup if Chrome asks", false);

      lute.connect("testnet-v1.0").then(function(addrs) {
        if (!addrs || addrs.length === 0) throw new Error("No accounts selected in Lute");
        activeAccount = addrs[0];
        getEl("connectedAccountDisplay").textContent =
          activeAccount.slice(0, 10) + "\u2026" + activeAccount.slice(-8);
        getEl("accountCard").style.display = "block";
        setStatus("Connected \u2713  Fetching transaction\u2026", false);
        getEl("luteBtn").textContent = "Preparing transaction\u2026";

        return fetch("/api/prepare-txn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: activeAccount })
        });
      }).then(function(r) {
        return r.json().then(function(d) { return { ok: r.ok, data: d }; });
      }).then(function(result) {
        if (!result.ok || !result.data.txn) throw new Error(result.data.error || "Failed to prepare transaction");
        preparedTxnB64 = result.data.txn;
        var b = getEl("luteBtn");
        b.disabled = false;
        b.textContent = "\u26a1 Sign & Pay ${humanAmount} ${assetName} in Lute";
        b.onclick = step2Sign;
        setStatus("Ready \u2014 click the button to sign the transaction in Lute.", false);
      }).catch(function(err) {
        var b = getEl("luteBtn");
        b.disabled = false;
        b.textContent = "Connect Lute Wallet";
        b.onclick = step1Connect;
        if (err && err.message === "POPUP_BLOCKED") {
          showPopupBlockedWarning("moduStep1Connect");
        } else {
          setStatus("Error: " + ((err && err.message) || "Connect failed"), true);
        }
      });
    }

    // ─── STEP 2: sign ────────────────────────────────────────────────────────
    function step2Sign() {
      if (!preparedTxnB64) {
        setStatus("Transaction not ready yet, please wait\u2026", true);
        return;
      }
      var btn = getEl("luteBtn");
      btn.disabled = true;
      btn.textContent = "Signing in Lute\u2026";
      setStatus("Opening Lute to sign\u2026 approve the popup if Chrome asks", false);

      lute.signTxns([{ txn: preparedTxnB64 }]).then(function(signedTxns) {
        if (!signedTxns || !signedTxns[0]) throw new Error("Transaction was not signed in Lute");
        getEl("luteBtn").textContent = "Broadcasting\u2026";
        setStatus("Signed \u2713  Broadcasting to Algorand Testnet\u2026", false);

        return fetch("/api/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signedTxn: Array.from(signedTxns[0]) })
        });
      }).then(function(r) {
        return r.json().then(function(d) { return { ok: r.ok, data: d }; });
      }).then(function(result) {
        if (!result.ok || !result.data.txId) throw new Error(result.data.error || "Broadcast failed");
        setStatus("Confirmed on Testnet \u2713  TxID: " + result.data.txId, false);
        showSuccess(result.data.txId);
      }).catch(function(err) {
        var b = getEl("luteBtn");
        b.disabled = false;
        b.textContent = "\u26a1 Sign & Pay ${humanAmount} ${assetName} in Lute";
        if (err && err.message === "POPUP_BLOCKED") {
          showPopupBlockedWarning("moduStep2Sign");
        } else {
          setStatus("Error: " + ((err && err.message) || "Sign failed"), true);
        }
      });
    }

    // ─── Wire button + expose on window for onclick attribute ─────────────────
    // Expose on window so that onclick="window.moduStep1Connect()" works
    // even if MetaMask/SES has frozen the global scope for bare names.
    window.moduStep1Connect = step1Connect;
    window.moduStep2Sign = step2Sign;

    var btn = getEl("luteBtn");
    if (btn) {
      btn.onclick = step1Connect;
      btn.setAttribute("onclick", "window.moduStep1Connect()");
    }

  })(); // end IIFE
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
