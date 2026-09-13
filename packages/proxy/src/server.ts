import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  ALGORAND_ALGO_ASSET_ID,
  ALGORAND_TESTNET_USDC_ASA_ID,
  ALGORAND_MAINNET_USDC_ASA_ID,
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_PROXY_URL,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_NETWORK,
  DEFAULT_CHALLENGE_TIMEOUT_SECONDS,
  DECIMALS,
  X402_VERSION,
  generateNonce,
  toBaseUnits,
  PaymentReceipt,
  X402Challenge,
} from '@modu/shared';
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  FacilitatorClient,
} from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { AlgorandPaymentVerifier, IndexerClient } from './verifier.js';
import { forwardStream } from './forwarder.js';

export interface ProxyServerOptions {
  port?: number;
  host?: string;
  controlPlaneUrl?: string;
  proxyUrl?: string;
  facilitatorUrl?: string;
  facilitatorClient?: FacilitatorClient;
  network?: string;
  useLocalVerifier?: boolean;
  indexerClient?: IndexerClient;
  // Optional direct resolver for testing or in-process mode
  endpointResolver?: (identifier: string) => Promise<any | null>;
  logSink?: (log: any) => Promise<void>;
  nonceStore?: {
    saveNonce?: (nonce: string, endpointId: string, expiresAt: Date) => Promise<void>;
    claimPayment?: (nonce: string, txid: string, endpointId: string) => Promise<{ success: boolean; error?: string }>;
    isTxidSpent?: (txid: string) => Promise<boolean>;
    recordSpentTxid?: (txid: string, endpointId: string) => Promise<void>;
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

  const facilitatorUrl = (
    options.facilitatorUrl ||
    process.env.FACILITATOR_URL ||
    DEFAULT_FACILITATOR_URL
  ).replace(/\/$/, '');

  // Facilitator client (injected for unit testing or HTTP-based default)
  const facilitatorClient: FacilitatorClient =
    options.facilitatorClient ||
    new HTTPFacilitatorClient({ url: facilitatorUrl });

  // Optional local verifier fallback (USE_LOCAL_VERIFIER=true)
  const useLocalVerifier =
    options.useLocalVerifier ?? (process.env.USE_LOCAL_VERIFIER === 'true');
  const localVerifier = new AlgorandPaymentVerifier(options.indexerClient);

  // Network resolution: prefer CAIP-2 identifiers
  const rawNetwork = options.network || process.env.NETWORK || DEFAULT_NETWORK;
  const targetNetwork =
    rawNetwork === 'algorand-mainnet' || rawNetwork === ALGORAND_MAINNET_CAIP2
      ? ALGORAND_MAINNET_CAIP2
      : ALGORAND_TESTNET_CAIP2;

  const isMainnet = targetNetwork === ALGORAND_MAINNET_CAIP2;

  const app = Fastify({
    logger: false,
  });

  app.register(cors, { origin: true });

  // Cache for dynamic facilitator /supported query (feePayer addresses)
  let cachedSupported: { kinds?: any[]; signers?: Record<string, string[]> } | null = null;
  let supportedExpiresAt = 0;

  async function getFacilitatorFeePayer(network: string): Promise<string | undefined> {
    const now = Date.now();
    if (!cachedSupported || supportedExpiresAt <= now) {
      try {
        const supported = await facilitatorClient.getSupported();
        cachedSupported = supported as any;
        supportedExpiresAt = now + 60_000; // Cache for 1 minute
      } catch {
        // External facilitator /supported call failed or not reachable; proceed without dynamic feePayer
      }
    }
    if (cachedSupported?.kinds) {
      const match = cachedSupported.kinds.find((k: any) => k.network === network);
      if (match?.extra?.feePayer) {
        return match.extra.feePayer as string;
      }
    }
    if (cachedSupported?.signers?.['algorand:*']?.[0]) {
      return cachedSupported.signers['algorand:*'][0];
    }
    return undefined;
  }

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

  // ---------------------------------------------------------------------------
  // Replay Protection & Defense-in-Depth
  // ---------------------------------------------------------------------------
  // In the official x402 v2 exact AVM scheme, transactions are signed as atomic
  // transaction groups with explicit firstValid/lastValid rounds and unique txids.
  // When settled by the facilitator, the Algorand blockchain natively enforces
  // single-use execution (subsequent broadcast returns 'tx already in ledger').
  //
  // As defense-in-depth, modu proxy records and verifies the settled transaction ID
  // against the control plane to prevent replay attempts across proxy instances,
  // while retiring the old requirement for client-side 'modu:<nonce>' note embedding.
  const inMemorySpentTxids = new Set<string>();

  async function claimSettledPayment(txid: string, endpointId: string): Promise<{ success: boolean; error?: string }> {
    if (inMemorySpentTxids.has(txid)) {
      return { success: false, error: 'Payment transaction has already been spent' };
    }

    if (options.nonceStore?.isTxidSpent) {
      const spent = await options.nonceStore.isTxidSpent(txid);
      if (spent) {
        return { success: false, error: 'Payment transaction has already been spent' };
      }
      if (options.nonceStore.recordSpentTxid) {
        await options.nonceStore.recordSpentTxid(txid, endpointId);
      }
      inMemorySpentTxids.add(txid);
      return { success: true };
    }

    if (options.nonceStore?.claimPayment) {
      const res = await options.nonceStore.claimPayment('v2-settled', txid, endpointId);
      if (res.success) inMemorySpentTxids.add(txid);
      return res;
    }

    try {
      const res = await fetch(`${controlPlaneUrl}/api/internal/claim-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: 'v2-settled', txid, endpointId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Claim failed' }))) as any;
        if (err.error === 'Transaction ID has already been spent') {
          return { success: false, error: err.error };
        }
        // Legacy control-plane deployments reject unknown nonces with "Invalid or expired nonce".
        // In x402 v2, Algorand transactions are already confirmed single-use on chain.
        if (err.error === 'Invalid or expired nonce') {
          inMemorySpentTxids.add(txid);
          return { success: true };
        }
        return { success: false, error: err.error || 'Payment claim rejected' };
      }
      inMemorySpentTxids.add(txid);
      return { success: true };
    } catch {
      // If control plane is momentarily unreachable, do not fail a verified & settled on-chain payment
      inMemorySpentTxids.add(txid);
      return { success: true };
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
  app.get('/health', async () => ({
    status: 'ok',
    service: 'modu-proxy',
    facilitatorUrl,
    network: targetNetwork,
  }));

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

    const expectedAssetId =
      endpoint.asset === 'ALGO'
        ? ALGORAND_ALGO_ASSET_ID
        : isMainnet
        ? ALGORAND_MAINNET_USDC_ASA_ID
        : ALGORAND_TESTNET_USDC_ASA_ID;

    const assetName = endpoint.asset === 'ALGO' ? 'ALGO' : 'USDC';
    const decimals = DECIMALS[endpoint.asset] || 6;
    const expectedAmountMicro = toBaseUnits(endpoint.price, decimals);
    const resourceUrl = `${proxyBaseUrl}/p/${endpoint.slug}`;
    const challengeTimeout =
      parseInt(process.env.CHALLENGE_TIMEOUT_SECONDS || '', 10) ||
      DEFAULT_CHALLENGE_TIMEOUT_SECONDS;

    // Check incoming payment headers:
    // x402 v2 standard: 'x-payment' or 'payment-signature' (base64 JSON PaymentPayload)
    // Legacy fallback: 'x-payment-txid' (only if USE_LOCAL_VERIFIER=true)
    const paymentHeader = (req.headers['x-payment'] || req.headers['payment-signature']) as
      | string
      | undefined;
    const txidHeader = req.headers['x-payment-txid'] as string | undefined;

    // Support X-PAYMENT-TXID fallback (for CLI `modu get` browser Lute wallet flow)
    if (txidHeader && !paymentHeader) {
      const startTime = Date.now();
      const verification = await localVerifier.verify({
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

      const claimResult = await claimSettledPayment(txidHeader.trim(), endpoint.id);
      if (!claimResult.success) {
        return reply.status(402).send({
          error: 'Payment Required',
          message: claimResult.error || 'Payment has already been used',
        });
      }

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

      return await forwardStream(req, reply, { targetUrl, receipt });
    }

    // -------------------------------------------------------------------------
    // 1. Unpaid Request: Issue official x402 v2 PaymentRequired Challenge
    // -------------------------------------------------------------------------
    if (!paymentHeader) {
      const feePayer = await getFacilitatorFeePayer(targetNetwork);

      const challenge: X402Challenge = {
        x402Version: X402_VERSION,
        resource: {
          url: resourceUrl,
          description: 'modu-proxied API call',
          mimeType: 'application/json',
        },
        accepts: [
          {
            scheme: 'exact',
            network: targetNetwork,
            amount: expectedAmountMicro,
            maxAmountRequired: expectedAmountMicro,
            asset: expectedAssetId,
            payTo: endpoint.payoutAddress,
            resource: resourceUrl,
            description: 'modu-proxied API call',
            mimeType: 'application/json',
            maxTimeoutSeconds: challengeTimeout,
            extra: {
              name: assetName,
              decimals,
              ...(feePayer ? { feePayer } : {}),
            },
          },
        ],
      };

      // Set standard PAYMENT-REQUIRED base64 header alongside JSON response body
      try {
        const encoded = Buffer.from(JSON.stringify(challenge)).toString('base64');
        reply.header('PAYMENT-REQUIRED', encoded);
      } catch {
        // ignore
      }

      return reply.status(402).type('application/json').send(challenge);
    }

    // -------------------------------------------------------------------------
    // 2. Paid Request: Decode and Validate PaymentPayload
    // -------------------------------------------------------------------------
    let paymentPayload: any;
    try {
      const raw = paymentHeader.trim();
      const jsonStr = /^[A-Za-z0-9+/=_-]+$/.test(raw)
        ? Buffer.from(raw, 'base64').toString('utf8')
        : raw;
      paymentPayload = JSON.parse(jsonStr);
    } catch {
      return reply.status(400).send({
        error: 'Invalid Payment Header',
        message: 'Could not decode or parse X-PAYMENT header as base64 JSON',
      });
    }

    const feePayer = await getFacilitatorFeePayer(targetNetwork);
    const paymentRequirements = {
      scheme: 'exact',
      network: targetNetwork,
      amount: expectedAmountMicro,
      maxAmountRequired: expectedAmountMicro,
      asset: expectedAssetId,
      payTo: endpoint.payoutAddress,
      resource: resourceUrl,
      description: 'modu-proxied API call',
      mimeType: 'application/json',
      maxTimeoutSeconds: challengeTimeout,
      extra: {
        name: assetName,
        decimals,
        ...(feePayer ? { feePayer } : {}),
      },
    };

    // -------------------------------------------------------------------------
    // 3. Facilitator Verification (Simulates atomic group without broadcasting)
    // -------------------------------------------------------------------------
    const startTime = Date.now();
    let verifyResult: any;
    try {
      verifyResult = await facilitatorClient.verify(paymentPayload, paymentRequirements as any);
    } catch (err: any) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: err.invalidMessage || err.message || 'Payment verification simulation failed',
      });
    }

    if (!verifyResult || !verifyResult.isValid) {
      return reply.status(402).send({
        error: 'Payment Required',
        message:
          verifyResult?.invalidMessage ||
          verifyResult?.invalidReason ||
          'Payment verification failed',
      });
    }

    // -------------------------------------------------------------------------
    // 4. Facilitator Settlement (Co-signs fee-payer txn and broadcasts on-chain)
    // -------------------------------------------------------------------------
    let settleResult: any;
    try {
      settleResult = await facilitatorClient.settle(paymentPayload, paymentRequirements as any);
    } catch (err: any) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: err.errorMessage || err.message || 'Payment settlement failed',
      });
    }

    if (!settleResult || !settleResult.success) {
      return reply.status(402).send({
        error: 'Payment Required',
        message:
          settleResult?.errorMessage ||
          settleResult?.errorReason ||
          'Payment settlement failed',
      });
    }

    const settledTxid = settleResult.transaction || '';
    const payerAddress = settleResult.payer || verifyResult.payer || '';
    const settledAmount = settleResult.amount || expectedAmountMicro;

    // -------------------------------------------------------------------------
    // 5. Replay Protection: Prevent reuse of settled transaction ID
    // -------------------------------------------------------------------------
    const claimResult = await claimSettledPayment(settledTxid, endpoint.id);
    if (!claimResult.success) {
      return reply.status(402).send({
        error: 'Payment Required',
        message: claimResult.error || 'Payment transaction has already been spent',
      });
    }

    // -------------------------------------------------------------------------
    // 6. Forward Request to Origin API & Return Settlement Receipts
    // -------------------------------------------------------------------------
    const fullPath = req.url;
    const prefix = `/p/${slug}`;
    const subpath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : '';
    const cleanOrigin = endpoint.originUrl.replace(/\/$/, '');
    const targetUrl = `${cleanOrigin}${subpath}`;

    const receipt: PaymentReceipt = {
      status: 'settled',
      txid: settledTxid,
      payer: payerAddress,
      amount: settledAmount,
      asset: expectedAssetId,
      timestamp: new Date().toISOString(),
    };

    // Attach log listener to response finish event
    reply.raw.on('finish', () => {
      const latencyMs = Date.now() - startTime;
      reportLog({
        endpointId: endpoint.id,
        payerAddress,
        txid: settledTxid,
        amount: settledAmount,
        status: reply.raw.statusCode || 200,
        latencyMs,
      });
    });

    // Provide both X-PAYMENT-RESPONSE and PAYMENT-RESPONSE receipt headers
    reply.header('X-PAYMENT-RESPONSE', JSON.stringify(receipt));
    try {
      reply.header(
        'PAYMENT-RESPONSE',
        Buffer.from(JSON.stringify(settleResult)).toString('base64')
      );
    } catch {
      // ignore
    }

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
