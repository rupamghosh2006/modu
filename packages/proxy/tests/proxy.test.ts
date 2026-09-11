import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { buildProxyServer } from '../src/server.js';
import { ALGORAND_TESTNET_USDC_ASA_ID, encodeNote, X402Challenge } from '@modu/shared';

describe('x402 Edge Reverse Proxy Integration', () => {
  let originServer: http.Server;
  let originUrl: string;

  let proxyApp: any;
  let proxyBaseUrl: string;

  const testReceiver = 'TESTPAYOUTRECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const testPayer = 'TESTPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  const mockTransactions = new Map<string, any>();
  const nonces = new Map<string, { endpointId: string; expiresAt: Date; claimed: boolean }>();
  const spentTxids = new Set<string>();

  const testEndpoints = new Map<string, any>([
    [
      'active-api',
      {
        id: 'ep_1',
        slug: 'active-api',
        originUrl: '', // set dynamically in before()
        price: '0.01',
        asset: 'USDC',
        isActive: true,
        payoutAddress: testReceiver,
      },
    ],
    [
      'revoked-api',
      {
        id: 'ep_2',
        slug: 'revoked-api',
        originUrl: '',
        price: '0.01',
        asset: 'USDC',
        isActive: false,
        payoutAddress: testReceiver,
      },
    ],
  ]);

  before(async () => {
    // 1. Origin HTTP Server
    originServer = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Origin-Header': 'origin-value',
      });
      res.end(JSON.stringify({ greeting: 'hello from origin API', path: req.url }));
    });

    await new Promise<void>((resolve) => {
      originServer.listen(0, '127.0.0.1', () => {
        const addr = originServer.address() as any;
        originUrl = `http://127.0.0.1:${addr.port}`;
        testEndpoints.get('active-api').originUrl = originUrl;
        testEndpoints.get('revoked-api').originUrl = originUrl;
        resolve();
      });
    });

    // 2. Proxy Server
    proxyApp = buildProxyServer({
      proxyUrl: 'http://localhost:4000',
      endpointResolver: async (slug: string) => testEndpoints.get(slug) || null,
      indexerClient: {
        getTransaction: async (txid: string) => mockTransactions.get(txid) || null,
      },
      nonceStore: {
        saveNonce: async (nonce, endpointId, expiresAt) => {
          nonces.set(nonce, { endpointId, expiresAt, claimed: false });
        },
        claimPayment: async (nonce, txid, endpointId) => {
          if (spentTxids.has(txid)) {
            return { success: false, error: 'Transaction ID already spent' };
          }
          const item = nonces.get(nonce);
          if (!item || item.claimed || item.endpointId !== endpointId) {
            return { success: false, error: 'Invalid or already claimed nonce' };
          }
          item.claimed = true;
          spentTxids.add(txid);
          return { success: true };
        },
      },
    });

    const proxyAddress = await proxyApp.listen({ port: 0, host: '127.0.0.1' });
    proxyBaseUrl = proxyAddress;
  });

  after(async () => {
    originServer.close();
    await proxyApp.close();
  });

  it('returns 404 for non-existent endpoint', async () => {
    const res = await fetch(`${proxyBaseUrl}/p/unknown-route`);
    assert.strictEqual(res.status, 404);
  });

  it('returns 410 Gone for revoked endpoint immediately', async () => {
    const res = await fetch(`${proxyBaseUrl}/p/revoked-api`);
    assert.strictEqual(res.status, 410);
    const body = (await res.json()) as any;
    assert.match(body.error, /revoked/i);
  });

  it('returns 402 Payment Required with valid x402 challenge on unpaid request', async () => {
    const res = await fetch(`${proxyBaseUrl}/p/active-api/users?limit=10`);
    assert.strictEqual(res.status, 402);
    assert.strictEqual(res.headers.get('content-type')?.includes('application/json'), true);

    const challenge = (await res.json()) as X402Challenge;
    assert.strictEqual(challenge.x402Version, 1);
    assert.strictEqual(Array.isArray(challenge.accepts), true);
    assert.strictEqual(challenge.accepts.length, 1);

    const accept = challenge.accepts[0];
    assert.strictEqual(accept.scheme, 'exact');
    assert.strictEqual(accept.network, 'algorand-testnet');
    assert.strictEqual(accept.maxAmountRequired, '10000'); // 0.01 USDC = 10000 microUSDC
    assert.strictEqual(accept.asset, ALGORAND_TESTNET_USDC_ASA_ID);
    assert.strictEqual(accept.payTo, testReceiver);
    assert.strictEqual(accept.resource, 'http://localhost:4000/p/active-api');
    assert.ok(accept.nonce, 'Nonce must be present');
  });

  it('verifies Algorand payment, settles, streams origin response, and returns receipt', async () => {
    // 1. Send unpaid request to get challenge and nonce
    const chalRes = await fetch(`${proxyBaseUrl}/p/active-api/greet`);
    assert.strictEqual(chalRes.status, 402);
    const challenge = (await chalRes.json()) as X402Challenge;
    const nonce = challenge.accepts[0].nonce!;

    // 2. Mint mock transaction on Algorand testnet
    const txid = 'ALGO_TX_VALID_12345';
    const noteBase64 = Buffer.from(encodeNote(nonce)).toString('base64');
    mockTransactions.set(txid, {
      id: txid,
      'confirmed-round': 40000100,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: testReceiver,
        amount: 10000,
      },
      note: noteBase64,
    });

    // 3. Retry request with X-PAYMENT-TXID
    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT-TXID': txid,
      },
    });

    assert.strictEqual(res.status, 200);

    // Verify origin response streaming
    const body = (await res.json()) as any;
    assert.strictEqual(body.greeting, 'hello from origin API');
    assert.strictEqual(body.path, '/greet');

    // Verify settlement receipt header
    const receiptHeader = res.headers.get('x-payment-response');
    assert.ok(receiptHeader, 'X-PAYMENT-RESPONSE header must be present');
    const receipt = JSON.parse(receiptHeader);
    assert.strictEqual(receipt.status, 'settled');
    assert.strictEqual(receipt.txid, txid);
    assert.strictEqual(receipt.payer, testPayer);
    assert.strictEqual(receipt.amount, '10000');
  });

  it('prevents replay attacks when reusing the same transaction ID', async () => {
    // Attempt to reuse txid 'ALGO_TX_VALID_12345'
    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT-TXID': 'ALGO_TX_VALID_12345',
      },
    });

    assert.strictEqual(res.status, 402);
    const body = (await res.json()) as any;
    assert.match(body.message, /already been used|already spent/i);
  });
});
