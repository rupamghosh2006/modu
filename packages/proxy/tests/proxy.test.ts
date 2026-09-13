import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { buildProxyServer } from '../src/server.js';
import {
  ALGORAND_TESTNET_USDC_ASA_ID,
  ALGORAND_TESTNET_CAIP2,
  X402Challenge,
  encodeNote,
} from '@modu/shared';
import { FacilitatorClient } from '@x402/core/server';

describe('x402 Edge Reverse Proxy Integration (Facilitator Flow)', () => {
  let originServer: http.Server;
  let originUrl: string;

  let proxyApp: any;
  let proxyBaseUrl: string;

  const testReceiver = 'TESTPAYOUTRECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const testPayer = 'TESTPAYERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  const spentTxids = new Set<string>();
  const mockTransactions = new Map<string, any>();

  class MockFacilitatorClient implements FacilitatorClient {
    public verifyCalls: any[] = [];
    public settleCalls: any[] = [];
    public shouldVerifyFail = false;
    public verifyErrorMessage = 'Simulation failed: insufficient funds';
    public shouldSettleFail = false;
    public settleErrorMessage = 'Settlement broadcast failed';
    public feePayer = 'ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA';

    async getSupported(): Promise<any> {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: ALGORAND_TESTNET_CAIP2,
            extra: { feePayer: this.feePayer },
          },
        ],
        extensions: [],
        signers: {
          'algorand:*': [this.feePayer],
        },
      };
    }

    async verify(paymentPayload: any, paymentRequirements: any): Promise<any> {
      this.verifyCalls.push({ paymentPayload, paymentRequirements });
      if (this.shouldVerifyFail) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_avm_simulation_failed',
          invalidMessage: this.verifyErrorMessage,
        };
      }
      return {
        isValid: true,
        payer: testPayer,
      };
    }

    async settle(paymentPayload: any, paymentRequirements: any): Promise<any> {
      this.settleCalls.push({ paymentPayload, paymentRequirements });
      if (this.shouldSettleFail) {
        return {
          success: false,
          errorReason: 'invalid_exact_avm_settlement_failed',
          errorMessage: this.settleErrorMessage,
        };
      }
      return {
        success: true,
        transaction: 'SETTLED_TXID_ALGO_987654321',
        network: ALGORAND_TESTNET_CAIP2,
        payer: testPayer,
        amount: paymentRequirements.amount || '10000',
      };
    }
  }

  let mockFacilitator: MockFacilitatorClient;

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

    // 2. Proxy Server with MockFacilitatorClient
    mockFacilitator = new MockFacilitatorClient();

    proxyApp = buildProxyServer({
      proxyUrl: 'http://localhost:4000',
      facilitatorClient: mockFacilitator,
      useLocalVerifier: true,
      endpointResolver: async (slug: string) => testEndpoints.get(slug) || null,
      indexerClient: {
        getTransaction: async (txid: string) => mockTransactions.get(txid) || null,
      },
      nonceStore: {
        isTxidSpent: async (txid: string) => spentTxids.has(txid),
        recordSpentTxid: async (txid: string) => {
          spentTxids.add(txid);
        },
        claimPayment: async (_nonce: string, txid: string) => {
          if (spentTxids.has(txid)) {
            return { success: false, error: 'Transaction ID already spent' };
          }
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

  beforeEach(() => {
    mockFacilitator.verifyCalls = [];
    mockFacilitator.settleCalls = [];
    mockFacilitator.shouldVerifyFail = false;
    mockFacilitator.shouldSettleFail = false;
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

  it('returns 402 Payment Required with official v2 challenge on unpaid request', async () => {
    const res = await fetch(`${proxyBaseUrl}/p/active-api/users?limit=10`);
    assert.strictEqual(res.status, 402);
    assert.strictEqual(res.headers.get('content-type')?.includes('application/json'), true);

    const challenge = (await res.json()) as X402Challenge;
    // v2 challenge shape
    assert.strictEqual(challenge.x402Version, 2);
    assert.ok(challenge.resource, 'Resource object must be present in v2');
    assert.strictEqual(challenge.resource?.url, 'http://localhost:4000/p/active-api');

    assert.strictEqual(Array.isArray(challenge.accepts), true);
    assert.strictEqual(challenge.accepts.length, 1);

    const accept = challenge.accepts[0];
    assert.strictEqual(accept.scheme, 'exact');
    assert.strictEqual(accept.network, ALGORAND_TESTNET_CAIP2);
    assert.strictEqual(accept.amount, '10000'); // 0.01 USDC = 10000 microUSDC
    assert.strictEqual(accept.asset, ALGORAND_TESTNET_USDC_ASA_ID);
    assert.strictEqual(accept.payTo, testReceiver);
    assert.strictEqual(accept.resource, 'http://localhost:4000/p/active-api');
    assert.strictEqual(accept.extra?.feePayer, mockFacilitator.feePayer);

    // Verify PAYMENT-REQUIRED base64 header
    const paymentRequiredHeader = res.headers.get('payment-required');
    assert.ok(paymentRequiredHeader, 'PAYMENT-REQUIRED header should be present');
    const decoded = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString('utf8'));
    assert.strictEqual(decoded.x402Version, 2);
  });

  it('verifies and settles payment with X-PAYMENT header, streams origin response, and returns receipt', async () => {
    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network: ALGORAND_TESTNET_CAIP2,
      payload: {
        paymentGroup: ['base64_signed_client_txn', 'base64_unsigned_fee_payer_txn'],
        paymentIndex: 0,
      },
    };

    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT': paymentHeader,
      },
    });

    assert.strictEqual(res.status, 200);

    // Facilitator verify and settle must have been invoked
    assert.strictEqual(mockFacilitator.verifyCalls.length, 1);
    assert.strictEqual(mockFacilitator.settleCalls.length, 1);

    // Verify origin response streaming
    const body = (await res.json()) as any;
    assert.strictEqual(body.greeting, 'hello from origin API');
    assert.strictEqual(body.path, '/greet');

    // Verify settlement receipt header (both X-PAYMENT-RESPONSE and PAYMENT-RESPONSE)
    const receiptHeader = res.headers.get('x-payment-response');
    assert.ok(receiptHeader, 'X-PAYMENT-RESPONSE header must be present');
    const receipt = JSON.parse(receiptHeader);
    assert.strictEqual(receipt.status, 'settled');
    assert.strictEqual(receipt.txid, 'SETTLED_TXID_ALGO_987654321');
    assert.strictEqual(receipt.payer, testPayer);
    assert.strictEqual(receipt.amount, '10000');

    const v2ReceiptHeader = res.headers.get('payment-response');
    assert.ok(v2ReceiptHeader, 'PAYMENT-RESPONSE header must be present');
  });

  it('prevents replay attacks when reusing the same settled transaction ID', async () => {
    // Attempt to reuse the already settled transaction ID 'SETTLED_TXID_ALGO_987654321'
    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network: ALGORAND_TESTNET_CAIP2,
      payload: {
        paymentGroup: ['replay_txn'],
        paymentIndex: 0,
      },
    };

    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT': paymentHeader,
      },
    });

    assert.strictEqual(res.status, 402);
    const body = (await res.json()) as any;
    assert.match(body.message, /already been spent/i);
  });

  it('rejects payment when facilitator verify (simulation) fails', async () => {
    mockFacilitator.shouldVerifyFail = true;
    mockFacilitator.verifyErrorMessage = 'Simulation failed: account has insufficient USDC balance';

    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network: ALGORAND_TESTNET_CAIP2,
      payload: { paymentGroup: ['bad_txn'], paymentIndex: 0 },
    };

    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      },
    });

    assert.strictEqual(res.status, 402);
    const body = (await res.json()) as any;
    assert.match(body.message, /insufficient USDC balance/i);
    assert.strictEqual(mockFacilitator.settleCalls.length, 0); // Settle should NOT be attempted
  });

  it('rejects payment when facilitator settle fails', async () => {
    mockFacilitator.shouldSettleFail = true;
    mockFacilitator.settleErrorMessage = 'Fee-payer signature rejected on-chain';

    const paymentPayload = {
      x402Version: 2,
      scheme: 'exact',
      network: ALGORAND_TESTNET_CAIP2,
      payload: { paymentGroup: ['fail_settle_txn'], paymentIndex: 0 },
    };

    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      },
    });

    assert.strictEqual(res.status, 402);
    const body = (await res.json()) as any;
    assert.match(body.message, /Fee-payer signature rejected/i);
  });

  it('supports legacy fallback flow with X-PAYMENT-TXID when enabled', async () => {
    const txid = 'FALLBACK_LEGACY_TXID_123';
    mockTransactions.set(txid, {
      id: txid,
      'confirmed-round': 40000200,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: testReceiver,
        amount: 10000,
      },
    });

    const res = await fetch(`${proxyBaseUrl}/p/active-api/greet`, {
      headers: {
        'X-PAYMENT-TXID': txid,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.greeting, 'hello from origin API');

    const receiptHeader = res.headers.get('x-payment-response');
    assert.ok(receiptHeader);
    const receipt = JSON.parse(receiptHeader);
    assert.strictEqual(receipt.status, 'settled');
    assert.strictEqual(receipt.txid, txid);
  });
});

