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
    if (!token) {
      reply.status(400).type('text/html').send('<h3>Error: Missing token</h3>');
      return;
    }

    const session = await store.getCliSession(token);
    if (!session) {
      reply.status(400).type('text/html').send('<h3>Error: Invalid or expired token</h3>');
      return;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>modu CLI Authentication</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; width: 420px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #58a6ff; }
    p { line-height: 1.5; color: #8b949e; }
    .code { font-family: monospace; background: #21262d; padding: 6px 12px; border-radius: 4px; display: inline-block; margin: 8px 0; color: #f0f6fc; }
    input[type=email] { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #f0f6fc; margin: 12px 0; }
    button { width: 100%; padding: 12px; background: #238636; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 15px; }
    button:hover { background: #2ea043; }
    .success { display: none; color: #3fb950; font-weight: 600; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚡ Authorize modu CLI</h2>
    <p>A CLI session is requesting access to manage your x402 endpoints and payouts.</p>
    <div class="code">Token: ${token.slice(0, 8)}...</div>
    <form id="authForm" onsubmit="handleClaim(event)">
      <label for="email" style="font-size: 13px; color: #8b949e;">Developer Email (optional):</label>
      <input type="email" id="email" placeholder="dev@example.com"/>
      <button type="submit" id="submitBtn">Authorize CLI</button>
    </form>
    <div id="successMsg" class="success">✓ Authorized! You may now return to your terminal.</div>
  </div>
  <script>
    async function handleClaim(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.innerText = 'Authorizing...';
      const email = document.getElementById('email').value.trim() || undefined;
      const res = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '${token}', email })
      });
      if (res.ok) {
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('successMsg').style.display = 'block';
      } else {
        alert('Authorization failed');
        btn.disabled = false;
        btn.innerText = 'Authorize CLI';
      }
    }
  </script>
</body>
</html>`;
    reply.type('text/html').send(html);
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
      nonce: string;
      txid: string;
      endpointId: string;
    };

    if (await store.isTxidSpent(txid)) {
      reply.status(400).send({ error: 'Transaction ID has already been spent' });
      return;
    }

    const claimedEndpointId = await store.claimNonce(nonce);
    if (!claimedEndpointId || claimedEndpointId !== endpointId) {
      reply.status(400).send({ error: 'Invalid or expired nonce' });
      return;
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
