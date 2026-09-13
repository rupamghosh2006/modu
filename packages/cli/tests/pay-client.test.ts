import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callPaidEndpoint, X402Challenge } from '../src/lib/payClient.js';

describe('payClient Unit Tests (x402 Payment Flow)', () => {
  let mockServer: http.Server;
  let mockServerUrl: string;

  // Test state controller
  let responseMode:
    | '200_ok'
    | '404_not_found'
    | '500_server_error'
    | '410_revoked'
    | '402_malformed_json'
    | '402_empty_accepts'
    | '402_missing_fields'
    | '402_algo_asset'
    | '402_valid_then_settle'
    | '402_valid_then_facilitator_fail' = '200_ok';

  let receivedPaymentHeader: string | null = null;

  const validChallenge: X402Challenge = {
    x402Version: 2,
    resource: {
      url: 'http://127.0.0.1/p/test-endpoint',
      description: 'Test API',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
        amount: '20000',
        asset: '10458941',
        payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
        maxTimeoutSeconds: 300,
        extra: {
          name: 'USDC',
          decimals: 6,
          feePayer: '5HQVA7F4G4EJEZHDA3JT763RPCR5NOPERFI5R4HKAKFZA4WDP55NTXQODY',
        },
      },
    ],
  };

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const paymentHeader = req.headers['x-payment'] as string | undefined;

      if (paymentHeader) {
        receivedPaymentHeader = paymentHeader;
        if (responseMode === '402_valid_then_facilitator_fail') {
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Payment Required',
              message: 'Facilitator simulation failed: Insufficient asset balance',
            })
          );
          return;
        }

        // Settle success
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-payment-response': JSON.stringify({
            status: 'settled',
            txid: 'MOCK_SETTLED_TXID_1234567890ABCDEF',
            payer: 'TEST_PAYER_ADDRESS_12345',
            amount: '20000',
            asset: '10458941',
            timestamp: new Date().toISOString(),
          }),
        });
        res.end(JSON.stringify({ success: true, data: 'premium origin data' }));
        return;
      }

      switch (responseMode) {
        case '200_ok':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'public unauthenticated data' }));
          break;

        case '404_not_found':
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Endpoint 'test-endpoint' not found" }));
          break;

        case '410_revoked':
          res.writeHead(410, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint revoked' }));
          break;

        case '500_server_error':
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
          break;

        case '402_malformed_json':
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end('NOT_VALID_JSON_{{[');
          break;

        case '402_empty_accepts':
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ x402Version: 2, accepts: [] }));
          break;

        case '402_missing_fields':
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              x402Version: 2,
              accepts: [{ scheme: 'exact', network: 'algorand:test' }],
            })
          );
          break;

        case '402_algo_asset':
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              x402Version: 2,
              accepts: [
                {
                  scheme: 'exact',
                  network: 'algorand:test',
                  amount: '1000000',
                  asset: '0',
                  payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
                  extra: { name: 'ALGO' },
                },
              ],
            })
          );
          break;

        case '402_valid_then_settle':
        case '402_valid_then_facilitator_fail':
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(validChallenge));
          break;

        default:
          res.writeHead(400);
          res.end();
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockServer.address() as any;
    mockServerUrl = `http://127.0.0.1:${addr.port}/p/test-endpoint`;
  });

  after(() => {
    mockServer.close();
  });

  // 1. Initial 200 OK
  it('returns response body directly without payment when endpoint returns 200 OK', async () => {
    responseMode = '200_ok';
    const result = await callPaidEndpoint(mockServerUrl);
    assert.equal(result.settled, false);
    assert.deepEqual(result.responseBody, { message: 'public unauthenticated data' });
  });

  // 2. Error: 404 Not Found
  it('throws descriptive error when endpoint is not found (404)', async () => {
    responseMode = '404_not_found';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('Endpoint not found (404)'));
        return true;
      }
    );
  });

  // 3. Error: 410 Gone
  it('throws descriptive error when endpoint is revoked (410)', async () => {
    responseMode = '410_revoked';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('Endpoint revoked (410)'));
        return true;
      }
    );
  });

  // 4. Error: 500 Server Error
  it('throws descriptive error for non-200/402 responses (e.g. 500)', async () => {
    responseMode = '500_server_error';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('HTTP 500'));
        return true;
      }
    );
  });

  // 5. 402 Challenge parsing: Malformed non-JSON
  it('throws descriptive error when 402 response is not valid JSON', async () => {
    responseMode = '402_malformed_json';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('Response is not valid JSON'));
        return true;
      }
    );
  });

  // 6. 402 Challenge parsing: Missing accepts array
  it('throws descriptive error when 402 challenge has missing or empty accepts', async () => {
    responseMode = '402_empty_accepts';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('Missing or empty accepts array'));
        return true;
      }
    );
  });

  // 7. 402 Challenge parsing: Missing required fields
  it('throws descriptive error when 402 challenge is missing payTo or amount', async () => {
    responseMode = '402_missing_fields';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('Missing required fields'));
        return true;
      }
    );
  });

  // 8. 402 Challenge parsing: Rejects native ALGO
  it('throws descriptive error when endpoint requires native ALGO instead of ASA/USDC', async () => {
    responseMode = '402_algo_asset';
    await assert.rejects(
      callPaidEndpoint(mockServerUrl),
      (err: Error) => {
        assert(err.message.includes('native ALGO payment, which is not supported'));
        return true;
      }
    );
  });

  // 9. Confirmation gate: Rejects when confirmBeforePay returns false
  it('rejects and aborts payment without signing when confirmBeforePay returns false', async () => {
    responseMode = '402_valid_then_settle';
    let confirmationCalled = false;
    let receivedChallenge: X402Challenge | null = null;

    await assert.rejects(
      callPaidEndpoint(mockServerUrl, {
        confirmBeforePay: async (challenge) => {
          confirmationCalled = true;
          receivedChallenge = challenge;
          return false; // Abort
        },
      }),
      (err: Error) => {
        assert(err.message.includes('Payment confirmation rejected or aborted'));
        return true;
      }
    );

    assert.equal(confirmationCalled, true);
    assert.equal(receivedChallenge?.accepts?.[0]?.asset, '10458941');
  });

  // 10. Missing credentials
  it('throws descriptive error when mnemonic or private key is missing', async () => {
    responseMode = '402_valid_then_settle';
    const oldMnemonic = process.env.ALGORAND_MNEMONIC;
    const oldKey = process.env.AVM_PRIVATE_KEY;
    delete process.env.ALGORAND_MNEMONIC;
    delete process.env.AVM_PRIVATE_KEY;

    try {
      await assert.rejects(
        callPaidEndpoint(mockServerUrl, {
          confirmBeforePay: async () => true,
        }),
        (err: Error) => {
          assert(err.message.includes('Either ALGORAND_MNEMONIC'));
          return true;
        }
      );
    } finally {
      if (oldMnemonic) process.env.ALGORAND_MNEMONIC = oldMnemonic;
      if (oldKey) process.env.AVM_PRIVATE_KEY = oldKey;
    }
  });

  // 11. Complete mocked payment flow (confirmBeforePay resolves true, signs & settles)
  it('proceeds with payment when confirmed and returns settlement receipt + body', async () => {
    responseMode = '402_valid_then_settle';
    receivedPaymentHeader = null;

    // Mock x402Client to avoid any external network/Algod calls
    const mockClient = {
      createPaymentPayload: async (_challenge: any) => ({
        paymentGroup: ['mock-signed-txn-base64', 'mock-fee-payer-txn-base64'],
        paymentIndex: 0,
      }),
    } as any;

    let confirmed = false;
    const result = await callPaidEndpoint(mockServerUrl, {
      mnemonic:
        'wire shuffle tiger resemble globe shift stay lift imitate logic spring mask alcohol speak garden method ribbon subject drama mango ice there tent about egg',
      client: mockClient,
      confirmBeforePay: async (_challenge) => {
        confirmed = true;
        return true;
      },
    });

    assert.equal(confirmed, true);
    assert.equal(result.settled, true);
    assert.equal(result.txid, 'MOCK_SETTLED_TXID_1234567890ABCDEF');
    assert.equal(result.payer, 'TEST_PAYER_ADDRESS_12345');
    assert.equal(result.amount, '20000');
    assert.equal(result.asset, '10458941');
    assert.deepEqual(result.responseBody, { success: true, data: 'premium origin data' });

    // Verify X-PAYMENT header was sent as base64 JSON
    assert(receivedPaymentHeader !== null);
    const decoded = JSON.parse(Buffer.from(receivedPaymentHeader!, 'base64').toString('utf8'));
    assert.deepEqual(decoded.paymentGroup, [
      'mock-signed-txn-base64',
      'mock-fee-payer-txn-base64',
    ]);
  });

  // 12. Facilitator failure handling on retry
  it('surfaces descriptive error when facilitator verify/settle fails (402 on retry)', async () => {
    responseMode = '402_valid_then_facilitator_fail';

    const mockClient = {
      createPaymentPayload: async () => ({
        paymentGroup: ['mock-signed-txn-base64'],
        paymentIndex: 0,
      }),
    } as any;

    await assert.rejects(
      callPaidEndpoint(mockServerUrl, {
        mnemonic:
          'wire shuffle tiger resemble globe shift stay lift imitate logic spring mask alcohol speak garden method ribbon subject drama mango ice there tent about egg',
        client: mockClient,
        confirmBeforePay: async () => true,
      }),
      (err: Error) => {
        assert(
          err.message.includes('Facilitator verify/settle failure (402): Facilitator simulation failed')
        );
        return true;
      }
    );
  });
});
