import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import algosdk from 'algosdk';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {
  AssetType,
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_PROXY_URL,
  RegisterEndpointDto,
} from '@modu/shared';
import { DataStore, MemoryDataStore } from './store.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  store?: DataStore;
  controlPlaneUrl?: string;
  proxyUrl?: string;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const store = options.store || new MemoryDataStore();
  let controlPlaneUrl = (options.controlPlaneUrl || process.env.CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(controlPlaneUrl)) {
    controlPlaneUrl = `https://${controlPlaneUrl}`;
  }

  let proxyUrl = (options.proxyUrl || process.env.PROXY_URL || DEFAULT_PROXY_URL).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(proxyUrl)) {
    proxyUrl = `https://${proxyUrl}`;
  }

  const app = Fastify({
    logger: false,
  });

  app.register(cors, { origin: true });

  // Event emitter for SSE log streaming
  const logSubscribers = new Map<string, Set<(log: any) => void>>();

  function broadcastLog(endpointId: string, log: any) {
    const subs = logSubscribers.get(endpointId);
    if (subs) {
      for (const listener of subs) {
        listener(log);
      }
    }
  }

  // Auth helper: extracts and validates API key from Bearer token
  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing or invalid Authorization header' });
      return null;
    }
    const apiKey = authHeader.slice(7).trim();
    const account = await store.getAccountByApiKey(apiKey);
    if (!account) {
      reply.status(401).send({ error: 'Invalid API key' });
      return null;
    }
    return account;
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // ==========================================
  // Auth & CLI Session Routes
  // ==========================================

  // Initiate CLI auth token
  app.post('/api/auth/cli-token', async (req) => {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry
    await store.createCliSession(token, expiresAt);

    const base = (options.controlPlaneUrl || process.env.CONTROL_PLANE_URL)
      ? controlPlaneUrl
      : `${req.protocol}://${req.headers.host}`;

    return {
      token,
      authUrl: `${base}/cli-auth?token=${token}`,
      pollUrl: `${base}/api/auth/poll?token=${token}`,
    };
  });

  // Browser UI for developer to approve CLI login
  app.get('/cli-auth', async (req, reply) => {
    const { token } = req.query as { token?: string };

    const renderTerminalPage = (contentHtml: string, title = 'modu — cli-auth — 80×24') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
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
      width: 590px;
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
    .traffic-lights:hover .btn-close::after { content: '✕'; font-size: 7px; font-weight: 700; color: #4d0000; line-height: 1; }
    .traffic-lights:hover .btn-minimize::after { content: '−'; font-size: 9px; font-weight: 700; color: #5a3d00; line-height: 1; margin-top: -1px; }
    .traffic-lights:hover .btn-zoom::after { content: '⤢'; font-size: 7px; font-weight: 700; color: #003e08; line-height: 1; }
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
    .titlebar-icon {
      opacity: 0.75;
      display: inline-flex;
      align-items: center;
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
      margin-bottom: 16px;
      font-size: 13.5px;
    }
    .prompt-host { color: #34d399; font-weight: 600; }
    .prompt-path { color: #60a5fa; font-weight: 600; }
    .prompt-cmd { color: #f3f4f6; }
    .term-heading {
      font-size: 17px;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 8px;
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
      padding: 12px 14px;
      margin-bottom: 20px;
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
    .session-value { color: #f0f6fc; font-weight: 500; }
    .token-badge {
      background: #1e2430;
      border: 1px solid #384357;
      color: #79c0ff;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12.5px;
      letter-spacing: 0.5px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #e3b341;
      font-size: 12px;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #e3b341;
      display: inline-block;
      box-shadow: 0 0 6px #e3b341;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    .field-group { margin-bottom: 18px; }
    .field-label {
      display: block;
      font-size: 12.5px;
      color: #8b949e;
      margin-bottom: 8px;
    }
    .field-label .symbol { color: #79c0ff; margin-right: 4px; font-weight: bold; }
    .field-label .optional { color: #6e7681; }
    .input-shell {
      display: flex;
      align-items: center;
      background: #0d1015;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 0 12px;
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
    input[type="email"] {
      width: 100%;
      padding: 10px 0;
      background: transparent;
      border: none;
      outline: none;
      color: #f0f6fc;
      font-family: inherit;
      font-size: 13.5px;
    }
    input[type="email"]::placeholder { color: #484f58; }
    .btn-submit {
      width: 100%;
      padding: 11px 16px;
      background: #238636;
      border: 1px solid #2ea043;
      color: #ffffff;
      border-radius: 6px;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.15s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .btn-submit:hover:not(:disabled) {
      background: #2ea043;
      box-shadow: 0 4px 12px rgba(46, 160, 67, 0.35);
    }
    .btn-submit:active:not(:disabled) {
      background: #238636;
      transform: translateY(1px);
    }
    .btn-submit:disabled { opacity: 0.65; cursor: not-allowed; }
    .kbd-tag {
      font-size: 10.5px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      padding: 2px 5px;
      font-weight: normal;
      color: rgba(255, 255, 255, 0.9);
      letter-spacing: 0.3px;
    }
    .term-error {
      display: none;
      margin-top: 14px;
      padding: 10px 12px;
      background: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.4);
      border-radius: 6px;
      color: #ff7b72;
      font-size: 12.5px;
      line-height: 1.4;
    }
    .term-success {
      display: none;
      padding: 6px 0;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .success-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13.5px;
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
        <span class="titlebar-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 5h-9.586L8.707 3.293A1 1 0 0 0 8 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
          </svg>
        </span>
        <span>modu — zsh — 80×24</span>
      </div>
    </div>
    <div class="terminal-body">
      ${contentHtml}
    </div>
  </div>
</body>
</html>`;

    if (!token) {
      const errorHtml = `
        <div class="login-banner">Last login: on ttys003</div>
        <div class="cli-prompt-line">
          <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="prompt-cmd">modu login</span>
        </div>
        <div class="term-heading"><span style="color:#f85149">✖</span> Authentication Error</div>
        <p class="term-desc" style="color:#ff7b72;">Missing authorization token parameter.</p>
        <div class="process-done">[Process completed - exit code 1]</div>
        <div class="return-prompt">
          <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="cursor-block"></span>
        </div>`;
      reply.status(400).type('text/html').send(renderTerminalPage(errorHtml));
      return;
    }

    const session = await store.getCliSession(token);
    if (!session) {
      const errorHtml = `
        <div class="login-banner">Last login: on ttys003</div>
        <div class="cli-prompt-line">
          <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="prompt-cmd">modu login</span>
        </div>
        <div class="term-heading"><span style="color:#f85149">✖</span> Authentication Error</div>
        <p class="term-desc" style="color:#ff7b72;">Invalid or expired authorization token.</p>
        <p style="font-size:12.5px; color:#8b949e; margin-top:8px;">Please run <code style="color:#f0f6fc; background:#21262d; padding:2px 6px; border-radius:4px;">modu login</code> in your terminal to start a new session.</p>
        <div class="process-done">[Process completed - exit code 1]</div>
        <div class="return-prompt">
          <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="cursor-block"></span>
        </div>`;
      reply.status(400).type('text/html').send(renderTerminalPage(errorHtml));
      return;
    }

    const tokenSafe = JSON.stringify(token);
    const tokenDisplay = token.slice(0, 8);

    const mainHtml = `
      <div class="login-banner">Last login: on ttys003</div>
      
      <div class="cli-prompt-line">
        <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="prompt-cmd">modu login --authorize</span>
      </div>

      <div class="term-heading">
        <span>⚡</span> Authorize modu CLI
      </div>
      <p class="term-desc">
        A CLI session is requesting access to manage your x402 endpoints and payouts.
      </p>

      <div class="session-card" id="sessionCard">
        <div class="session-row">
          <span class="session-label">Session Token:</span>
          <span class="token-badge">${tokenDisplay}...</span>
        </div>
        <div class="session-row">
          <span class="session-label">Access Scope:</span>
          <span class="session-value" style="font-size: 12px; color: #8b949e;">endpoints:manage, payouts:manage</span>
        </div>
        <div class="session-row">
          <span class="session-label">Session Status:</span>
          <span class="status-badge"><span class="status-dot"></span> Waiting for approval</span>
        </div>
      </div>

      <form id="authForm" onsubmit="handleClaim(event)">
        <div class="field-group">
          <label for="email" class="field-label">
            <span class="symbol">?</span> Developer Email <span class="optional">(optional)</span>:
          </label>
          <div class="input-shell">
            <span class="input-chevron">❯</span>
            <input type="email" id="email" placeholder="dev@example.com" autofocus autocomplete="off" spellcheck="false"/>
          </div>
        </div>

        <button type="submit" id="submitBtn" class="btn-submit">
          <span>Authorize CLI</span>
          <span class="kbd-tag">↵ return</span>
        </button>
      </form>

      <div id="errorMsg" class="term-error"></div>

      <div id="successMsg" class="term-success">
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>Authorization granted! Session token linked.</span>
        </div>
        <div class="success-item">
          <span class="success-check">✓</span>
          <span>Credentials issued for modu CLI.</span>
        </div>
        <div class="success-dim">
          You may now close this tab and return to your terminal.
        </div>
        <div class="process-done">
          [Process completed]
        </div>
        <div class="return-prompt">
          <span class="prompt-host">developer@macbook</span>:<span class="prompt-path">~/modu</span>$ <span class="cursor-block"></span>
        </div>
      </div>

      <script>
        async function handleClaim(e) {
          e.preventDefault();
          const btn = document.getElementById('submitBtn');
          const errDiv = document.getElementById('errorMsg');
          errDiv.style.display = 'none';

          btn.disabled = true;
          btn.innerHTML = '<span>Authorizing session...</span>';
          const email = document.getElementById('email').value.trim() || undefined;

          try {
            const res = await fetch('/api/auth/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: ${tokenSafe}, email })
            });

            if (res.ok) {
              document.getElementById('authForm').style.display = 'none';
              document.getElementById('sessionCard').style.display = 'none';
              document.getElementById('successMsg').style.display = 'block';
            } else {
              const errData = await res.json().catch(() => ({ error: 'Authorization failed' }));
              errDiv.textContent = '✖ ' + (errData.error || 'Authorization failed. Please try again.');
              errDiv.style.display = 'block';
              btn.disabled = false;
              btn.innerHTML = '<span>Authorize CLI</span><span class="kbd-tag">↵ return</span>';
            }
          } catch (err) {
            errDiv.textContent = '✖ Network error connecting to control plane.';
            errDiv.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<span>Authorize CLI</span><span class="kbd-tag">↵ return</span>';
          }
        }
      </script>`;

    reply.type('text/html').send(renderTerminalPage(mainHtml));
  });

  // Claim CLI token
  app.post('/api/auth/claim', async (req, reply) => {
    const { token, email } = req.body as { token?: string; email?: string };
    if (!token) {
      reply.status(400).send({ error: 'Token is required' });
      return;
    }

    const session = await store.getCliSession(token);
    if (!session) {
      reply.status(400).send({ error: 'Session not found or expired' });
      return;
    }

    // Create or get account
    const account = await store.createAccount(email);
    await store.claimCliSession(token, account.id);

    return { success: true, accountId: account.id };
  });

  // Poll CLI session
  app.get('/api/auth/poll', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) {
      reply.status(400).send({ error: 'Token is required' });
      return;
    }

    const session = await store.getCliSession(token);
    if (!session) {
      return { status: 'expired' };
    }

    if (!session.claimed || !session.accountId) {
      return { status: 'pending' };
    }

    const account = await store.getAccountById(session.accountId);
    if (!account) {
      return { status: 'expired' };
    }

    return {
      status: 'claimed',
      apiKey: account.apiKey,
      payoutAddress: account.payoutAddress,
    };
  });

  // ==========================================
  // Account & Wallet Routes
  // ==========================================

  // Connect payout address
  app.post('/api/account/payout-address', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const { payoutAddress } = req.body as { payoutAddress?: string };
    if (!payoutAddress || !algosdk.isValidAddress(payoutAddress)) {
      reply.status(400).send({ error: 'Invalid Algorand address' });
      return;
    }

    const updated = await store.updatePayoutAddress(account.id, payoutAddress);
    return {
      success: true,
      payoutAddress: updated.payoutAddress,
    };
  });

  // Get current account info
  app.get('/api/account/me', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    return {
      id: account.id,
      email: account.email,
      payoutAddress: account.payoutAddress,
    };
  });

  // ==========================================
  // Endpoint Management Routes
  // ==========================================

  // Register new endpoint
  app.post('/api/endpoints', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const body = req.body as RegisterEndpointDto;
    if (!body.originUrl || !body.price || !body.asset) {
      reply.status(400).send({ error: 'Missing required fields: originUrl, price, asset' });
      return;
    }

    if (!['USDC', 'ALGO'].includes(body.asset)) {
      reply.status(400).send({ error: 'Invalid asset: must be USDC or ALGO' });
      return;
    }

    const numPrice = Number(body.price);
    if (isNaN(numPrice) || numPrice <= 0) {
      reply.status(400).send({ error: 'Price must be a positive number' });
      return;
    }

    if (!account.payoutAddress) {
      reply.status(400).send({
        error: 'No payout address connected. Please run `modu wallet connect <address>` first.',
      });
      return;
    }

    const slug = (body.path && body.path.trim()) || crypto.randomBytes(3).toString('hex');

    try {
      const endpoint = await store.createEndpoint({
        accountId: account.id,
        slug,
        originUrl: body.originUrl.trim(),
        price: String(body.price),
        asset: body.asset as AssetType,
      });

      return {
        endpointId: endpoint.id,
        slug: endpoint.slug,
        proxyUrl: `${proxyUrl}/p/${endpoint.slug}`,
        originUrl: endpoint.originUrl,
        price: endpoint.price,
        asset: endpoint.asset,
        payoutAddress: account.payoutAddress,
      };
    } catch (err: any) {
      reply.status(400).send({ error: err.message || 'Failed to create endpoint' });
    }
  });

  // List caller's registered endpoints
  app.get('/api/endpoints', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const endpoints = await store.getEndpointsByAccount(account.id);
    const summaries = await Promise.all(
      endpoints.map(async (e) => {
        const stats = await store.getStats(e.id);
        return {
          id: e.id,
          slug: e.slug,
          proxyUrl: `${proxyUrl}/p/${e.slug}`,
          originUrl: e.originUrl,
          price: e.price,
          asset: e.asset,
          requestsToday: stats.requestsToday,
          revenueToday: stats.revenueToday,
          isActive: e.isActive,
        };
      })
    );

    return summaries;
  });

  // Revoke endpoint
  app.delete('/api/endpoints/:id', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const { id } = req.params as { id: string };
    const success = await store.revokeEndpoint(id, account.id);
    if (!success) {
      reply.status(404).send({ error: 'Endpoint not found or unauthorized' });
      return;
    }

    return {
      success: true,
      endpointId: id,
      status: 'revoked',
    };
  });

  // Endpoint logs (supports ?follow=true for SSE)
  app.get('/api/endpoints/:id/logs', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const { id } = req.params as { id: string };
    const endpoint = await store.getEndpointById(id);
    if (!endpoint || endpoint.accountId !== account.id) {
      reply.status(404).send({ error: 'Endpoint not found' });
      return;
    }

    const { follow, limit } = req.query as { follow?: string; limit?: string };

    if (follow === 'true') {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Send recent logs first
      const recents = await store.getLogs(id, 10);
      for (const log of recents.reverse()) {
        reply.raw.write(`data: ${JSON.stringify(log)}\n\n`);
      }

      // Add subscriber
      if (!logSubscribers.has(id)) {
        logSubscribers.set(id, new Set());
      }
      const listener = (newLog: any) => {
        reply.raw.write(`data: ${JSON.stringify(newLog)}\n\n`);
      };
      logSubscribers.get(id)!.add(listener);

      req.raw.on('close', () => {
        logSubscribers.get(id)?.delete(listener);
      });

      return;
    }

    const logs = await store.getLogs(id, limit ? parseInt(limit, 10) : 50);
    return logs;
  });

  // Endpoint stats
  app.get('/api/endpoints/:id/stats', async (req, reply) => {
    const account = await requireAuth(req, reply);
    if (!account) return;

    const { id } = req.params as { id: string };
    const endpoint = await store.getEndpointById(id);
    if (!endpoint || endpoint.accountId !== account.id) {
      reply.status(404).send({ error: 'Endpoint not found' });
      return;
    }

    const stats = await store.getStats(id);
    return stats;
  });

  // ==========================================
  // Internal Proxy Routes
  // ==========================================

  // Resolve endpoint by slug or id
  app.get('/api/internal/endpoints/:identifier', async (req, reply) => {
    const { identifier } = req.params as { identifier: string };
    let endpoint = await store.getEndpointBySlug(identifier);
    if (!endpoint) {
      endpoint = await store.getEndpointById(identifier);
    }
    if (!endpoint) {
      reply.status(404).send({ error: 'Endpoint not found' });
      return;
    }

    const account = await store.getAccountById(endpoint.accountId);
    return {
      ...endpoint,
      payoutAddress: account?.payoutAddress || '',
    };
  });

  // Record settled request log
  app.post('/api/internal/logs', async (req) => {
    const body = req.body as {
      endpointId: string;
      payerAddress: string;
      txid: string;
      amount: string;
      status: number;
      latencyMs: number;
    };
    const log = await store.createRequestLog(body);
    broadcastLog(body.endpointId, log);
    return { success: true, logId: log.id };
  });

  // Issue challenge nonce
  app.post('/api/internal/nonces', async (req) => {
    const { nonce, endpointId, ttlSeconds } = req.body as {
      nonce: string;
      endpointId: string;
      ttlSeconds?: number;
    };
    const expiresAt = new Date(Date.now() + (ttlSeconds || 300) * 1000);
    await store.saveNonce(nonce, endpointId, expiresAt);
    return { success: true };
  });

  // Claim nonce & txid (single-use validation)
  app.post('/api/internal/claim-payment', async (req, reply) => {
    const { nonce, txid, endpointId } = req.body as {
      nonce?: string;
      txid: string;
      endpointId: string;
    };

    if (await store.isTxidSpent(txid)) {
      reply.status(400).send({ error: 'Transaction ID has already been spent' });
      return;
    }

    // In x402 v2, payments are verified and settled via atomic transaction groups on-chain.
    // Nonce validation is only performed for legacy v1 payments with client-embedded nonces.
    if (nonce && nonce !== 'v2-settled') {
      const claimedEndpointId = await store.claimNonce(nonce);
      if (!claimedEndpointId || claimedEndpointId !== endpointId) {
        reply.status(400).send({ error: 'Invalid or expired nonce' });
        return;
      }
    }

    await store.recordSpentTxid(txid, endpointId);
    return { success: true };
  });

  return app;
}

// Start standalone server when executed directly
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const defaultPersistPath = path.join(os.homedir(), '.modu', 'control-plane-store.json');
  const persistPath = process.env.MODU_STORE_PATH || defaultPersistPath;
  const store = new MemoryDataStore(persistPath);
  const server = buildServer({ store });

  server.listen({ port, host }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`modu control plane running at ${address}`);
    console.log(`Persistent data store: ${persistPath}`);
  });
}
