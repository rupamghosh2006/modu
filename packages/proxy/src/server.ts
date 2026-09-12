import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  ALGORAND_ALGO_ASSET_ID,
  ALGORAND_TESTNET_USDC_ASA_ID,
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_PROXY_URL,
  DEFAULT_NETWORK,
  DEFAULT_CHALLENGE_TIMEOUT_SECONDS,
  DECIMALS,
  X402_VERSION,
  generateNonce,
  toBaseUnits,
  PaymentReceipt,
  X402Challenge,
} from '@modu/shared';
import { AlgorandPaymentVerifier, IndexerClient } from './verifier.js';
import { forwardStream } from './forwarder.js';

export interface ProxyServerOptions {
  port?: number;
  host?: string;
  controlPlaneUrl?: string;
  proxyUrl?: string;
  indexerClient?: IndexerClient;
  // Optional direct resolver for testing or in-process mode
  endpointResolver?: (identifier: string) => Promise<any | null>;
  logSink?: (log: any) => Promise<void>;
  nonceStore?: {
    saveNonce: (nonce: string, endpointId: string, expiresAt: Date) => Promise<void>;
    claimPayment: (nonce: string, txid: string, endpointId: string) => Promise<{ success: boolean; error?: string }>;
  };
}

export function buildProxyServer(options: ProxyServerOptions = {}): FastifyInstance {
  let controlPlaneUrl = (options.controlPlaneUrl || process.env.CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(controlPlaneUrl)) {
    controlPlaneUrl = `https://${controlPlaneUrl}`;
  }

  let proxyBaseUrl = (options.proxyUrl || process.env.PROXY_URL || DEFAULT_PROXY_URL).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(proxyBaseUrl)) {
    proxyBaseUrl = `https://${proxyBaseUrl}`;
  }

  const verifier = new AlgorandPaymentVerifier(options.indexerClient);

  const app = Fastify({
    logger: false,
  });

  app.register(cors, { origin: true });

  // In-memory endpoint cache to eliminate roundtrip latency to control-plane
  interface CachedEndpoint {
    data: any;
    expiresAt: number;
  }
  const endpointCache = new Map<string, CachedEndpoint>();
  const ENDPOINT_CACHE_TTL_MS = 10_000; // 10 seconds TTL

  // Resolve endpoint from control plane or direct resolver (cached)
  async function getEndpoint(identifier: string) {
    if (options.endpointResolver) {
      return await options.endpointResolver(identifier);
    }
    const now = Date.now();
    const cached = endpointCache.get(identifier);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const res = await fetch(`${controlPlaneUrl}/api/internal/endpoints/${encodeURIComponent(identifier)}`);
      if (res.status === 404) {
        endpointCache.set(identifier, { data: null, expiresAt: now + 3_000 });
        return null;
      }
      if (!res.ok) throw new Error(`Control plane error: ${res.status}`);
      const data = await res.json();
      
      // Keep cache size bounded
      if (endpointCache.size > 2000) {
        endpointCache.clear();
      }
      endpointCache.set(identifier, { data, expiresAt: now + ENDPOINT_CACHE_TTL_MS });
      return data;
    } catch {
      return null;
    }
  }

  // Save challenge nonce
  async function saveChallengeNonce(nonce: string, endpointId: string, ttlSeconds: number) {
    if (options.nonceStore) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      return await options.nonceStore.saveNonce(nonce, endpointId, expiresAt);
    }
    try {
      await fetch(`${controlPlaneUrl}/api/internal/nonces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, endpointId, ttlSeconds }),
      });
    } catch (e) {
      // ignore
    }
  }

  // Claim payment (txid + nonce)
  async function claimPayment(nonce: string, txid: string, endpointId: string) {
    if (options.nonceStore) {
      return await options.nonceStore.claimPayment(nonce, txid, endpointId);
    }
    try {
      const res = await fetch(`${controlPlaneUrl}/api/internal/claim-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, txid, endpointId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Claim failed' })) as any;
        return { success: false, error: err.error || 'Payment claim rejected' };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // Report settled log
  async function reportLog(log: any) {
    if (options.logSink) {
      return await options.logSink(log);
    }
    try {
      await fetch(`${controlPlaneUrl}/api/internal/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      });
    } catch (e) {
      // ignore
    }
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'modu-proxy' }));

  // Main proxy route: matches /p/:slug and /p/:slug/*
  app.all('/p/:slug', handleProxy);
  app.all('/p/:slug/*', handleProxy);

  async function handleProxy(req: FastifyRequest, reply: FastifyReply) {
    const { slug } = req.params as { slug: string };
    const endpoint = await getEndpoint(slug);

    if (!endpoint) {
      return reply.status(404).send({ error: `Endpoint '${slug}' not found` });
    }

    if (!endpoint.isActive) {
      return reply.status(410).send({ error: 'Endpoint revoked' });
    }

    const expectedAssetId = endpoint.asset === 'ALGO' ? ALGORAND_ALGO_ASSET_ID : ALGORAND_TESTNET_USDC_ASA_ID;
    const decimals = DECIMALS[endpoint.asset] || 6;
    const expectedAmountMicro = toBaseUnits(endpoint.price, decimals);
    const resourceUrl = `${proxyBaseUrl}/p/${endpoint.slug}`;

    const txidHeader = req.headers['x-payment-txid'] as string | undefined;

    // If unpaid: issue 402 challenge
    if (!txidHeader) {
      const nonce = generateNonce(16);
      const challengeTimeout = parseInt(process.env.CHALLENGE_TIMEOUT_SECONDS || '', 10) || DEFAULT_CHALLENGE_TIMEOUT_SECONDS;
      await saveChallengeNonce(nonce, endpoint.id, challengeTimeout);

      const challenge: X402Challenge = {
        x402Version: X402_VERSION,
        accepts: [
          {
            scheme: 'exact',
            network: DEFAULT_NETWORK as any,
            maxAmountRequired: expectedAmountMicro,
            asset: expectedAssetId,
            payTo: endpoint.payoutAddress,
            resource: resourceUrl,
            description: 'modu-proxied API call',
            maxTimeoutSeconds: challengeTimeout,
            nonce,
          },
        ],
      };

      return reply.status(402).type('application/json').send(challenge);
    }

    // Payment proof provided: verify transaction
    const startTime = Date.now();
    const verification = await verifier.verify({
      txid: txidHeader.trim(),
      expectedReceiver: endpoint.payoutAddress,
      expectedAmountMicro,
      expectedAsset: expectedAssetId,
    });

    if (!verification.valid) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: verification.error || 'Payment verification failed',
      });
    }

    if (!verification.nonce) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: 'Missing challenge nonce in transaction note. Set the transaction note to modu:<nonce>',
      });
    }

    // Prevent replay attacks: ensure nonce and txid have not been spent
    const claimResult = await claimPayment(verification.nonce, txidHeader.trim(), endpoint.id);
    if (!claimResult.success) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: claimResult.error || 'Payment or challenge nonce has already been used',
      });
    }

    // Forward request to origin
    // Calculate subpath
    const fullPath = req.url;
    const prefix = `/p/${slug}`;
    const subpath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : '';
    const cleanOrigin = endpoint.originUrl.replace(/\/$/, '');
    const targetUrl = `${cleanOrigin}${subpath}`;

    const receipt: PaymentReceipt = {
      status: 'settled',
      txid: txidHeader.trim(),
      payer: verification.payer || '',
      amount: verification.amount || expectedAmountMicro,
      asset: verification.asset || expectedAssetId,
      timestamp: new Date().toISOString(),
    };

    // Attach log listener to finish event
    reply.raw.on('finish', () => {
      const latencyMs = Date.now() - startTime;
      reportLog({
        endpointId: endpoint.id,
        payerAddress: verification.payer || '',
        txid: txidHeader.trim(),
        amount: verification.amount || expectedAmountMicro,
        status: reply.raw.statusCode || 200,
        latencyMs,
      });
    });

    // Forward stream verbatim to origin
    return await forwardStream(req, reply, { targetUrl, receipt });
  }

  return app;
}

// Start standalone proxy when run directly
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  const port = parseInt(process.env.PORT || '4000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const server = buildProxyServer();

  server.listen({ port, host }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`modu edge proxy running at ${address}`);
  });
}
