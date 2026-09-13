import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getCommand, formatHttpResponse, renderPaymentPage } from '../src/commands/get.js';

describe('modu get Command & x402 Browser Payment Flow', () => {
  let mockServer: http.Server;
  let mockServerUrl: string;
  let receivedTxid: string | null = null;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const authTxid = req.headers['x-payment-txid'] as string | undefined;

      if (!authTxid) {
        if (req.url?.includes('v2')) {
          res.writeHead(402, {
            'Content-Type': 'application/json; charset=utf-8',
            'Server': 'mock-proxy',
            'payment-required': Buffer.from(
              JSON.stringify({
                x402Version: 2,
                resource: { url: 'https://modu-proxy.onrender.com/p/test-v2' },
                accepts: [
                  {
                    scheme: 'exact',
                    network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
                    amount: '120000',
                    asset: '10458941',
                    payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
                    maxTimeoutSeconds: 300,
                    extra: { name: 'USDC', decimals: 6 },
                  },
                ],
              })
            ).toString('base64'),
          });
          res.end(
            JSON.stringify({
              x402Version: 2,
              resource: { url: 'https://modu-proxy.onrender.com/p/test-v2' },
              accepts: [
                {
                  scheme: 'exact',
                  network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
                  amount: '120000',
                  asset: '10458941',
                  payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
                  maxTimeoutSeconds: 300,
                  extra: { name: 'USDC', decimals: 6 },
                },
              ],
            })
          );
          return;
        }

        // Return 402 challenge
        res.writeHead(402, {
          'Content-Type': 'application/json; charset=utf-8',
          'Server': 'mock-proxy',
        });
        res.end(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: 'exact',
                network: 'algorand-testnet',
                maxAmountRequired: '300000',
                asset: '0',
                payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
                resource: 'https://modu-proxy.onrender.com/p/test',
                description: 'modu-proxied API call',
                maxTimeoutSeconds: 300,
                nonce: 'mock_challenge_nonce_12345',
              },
            ],
          })
        );
        return;
      }

      // Paid request: verify and return 200 OK
      receivedTxid = authTxid;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-payment-response': JSON.stringify({
          status: 'settled',
          txid: authTxid,
          payer: '5HQVA7F4G4EJEZHDA3JT763RPCR5NOPERFI5R4HKAKFZA4WDP55NTXQODY',
          amount: '300000',
          asset: '0',
        }),
      });
      res.end(
        JSON.stringify({
          args: {},
          url: 'https://httpbin.org/get',
          success: true,
        })
      );
    });

    await new Promise<void>(resolve => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockServer.address() as any;
    mockServerUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    mockServer.close();
  });

  it('formats HTTP responses with status line, headers, and body', () => {
    const mockRes = {
      status: 200,
      statusText: 'OK',
      headers: new Map([
        ['Content-Type', 'application/json'],
        ['Server', 'modu-proxy'],
      ]),
    } as any;

    const formatted = formatHttpResponse(mockRes, JSON.stringify({ ok: true }));
    assert(formatted.includes('HTTP/1.1 200 OK'));
    assert(formatted.includes('content-type: application/json') || formatted.includes('Content-Type: application/json'));
    assert(formatted.includes('"ok": true'));
  });

  it('renders payment HTML page exclusively for Lute wallet connection and signing', () => {
    const html = renderPaymentPage({
      url: 'https://modu-proxy.onrender.com/p/e53c88',
      payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
      amountMicro: '300000',
      humanAmount: '0.3',
      assetName: 'ALGO',
      assetId: '0',
      nonce: '53e430bb780ff02753948102a6635223',
      network: 'algorand-testnet',
    });

    // Check that title, terminal aesthetic, and Lute branding are present
    assert(html.includes('modu — Lute Payment Approval — 80×24'));
    assert(html.includes('0.3 ALGO'));
    assert(html.includes('YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A'));
    assert(html.includes('53e430bb780f'));

    // Check that Lute Connect and button are present
    assert(html.includes('Lute Wallet'));
    assert(html.includes('Connect Lute Wallet'));
    assert(html.includes('class LuteConnect'));

    // Check that other wallets are NOT present
    assert(!html.includes('tab-pera'));
    assert(!html.includes('tab-defly'));
    assert(!html.includes('tab-kibisis'));
  });

  it('handles directly supplied --txid flag without opening payment server', async () => {
    receivedTxid = null;
    await getCommand(mockServerUrl, {
      txid: 'PRE_PAID_TXID_5VHQPKCJJIUYBGV2ZJACAMEFGBFHPATT6JBIWPYVQ7VZD5XLXZDA',
      autoOpen: false,
    });

    assert.equal(
      receivedTxid,
      'PRE_PAID_TXID_5VHQPKCJJIUYBGV2ZJACAMEFGBFHPATT6JBIWPYVQ7VZD5XLXZDA'
    );
  });

  it('receives 402 challenge, serves payment page, handles /api/complete callback, and retrieves paid response', async () => {
    receivedTxid = null;
    const testTxid = 'CONFIRMED_TXID_5VHQPKCJJIUYBGV2ZJACAMEFGBFHPATT6JBIWPYVQ7VZD5XLXZDA';

    // Intercept console.log to discover local payment URL
    const originalLog = console.log;
    let localPayUrl = '';
    console.log = (...args: any[]) => {
      originalLog(...args);
      const str = args.join(' ');
      const match = str.match(/http:\/\/127\.0\.0\.1:\d+\/pay/);
      if (match) {
        localPayUrl = match[0];
      }
    };

    try {
      // Start getCommand in background
      const getPromise = getCommand(mockServerUrl, {
        autoOpen: false,
        timeoutMs: 10_000,
      });

      // Poll until localPayUrl is detected
      const startTime = Date.now();
      while (!localPayUrl && Date.now() - startTime < 4000) {
        await new Promise(r => setTimeout(r, 50));
      }

      assert(localPayUrl, 'Local payment server URL should have been printed');

      // 1. Verify GET /pay serves HTML
      const payRes = await fetch(localPayUrl);
      assert.equal(payRes.status, 200);
      const payHtml = await payRes.text();
      assert(payHtml.includes('Lute Payment Approval'));

      // 2. Submit payment completion via POST /api/complete
      const completeUrl = localPayUrl.replace('/pay', '/api/complete');
      const completeRes = await fetch(completeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: testTxid }),
      });
      assert.equal(completeRes.status, 200);
      const completeData = await completeRes.json() as any;
      assert.equal(completeData.success, true);
      assert.equal(completeData.txId, testTxid);

      // Wait for getCommand to complete
      await getPromise;

      // Verify the proxy received the confirmed transaction ID
      assert.equal(receivedTxid, testTxid);
    } finally {
      console.log = originalLog;
    }
  });

  it('receives x402 v2 challenge without nonce, serves payment page, handles /api/complete, and retrieves paid response', async () => {
    receivedTxid = null;
    const testTxid = 'CONFIRMED_V2_TXID_5VHQPKCJJIUYBGV2ZJACAMEFGBFHPATT6JBIWPYVQ7VZD5XLXZDA';

    const originalLog = console.log;
    let localPayUrl = '';
    console.log = (...args: any[]) => {
      originalLog(...args);
      const str = args.join(' ');
      const match = str.match(/http:\/\/127\.0\.0\.1:\d+\/pay/);
      if (match) {
        localPayUrl = match[0];
      }
    };

    try {
      const getPromise = getCommand(`${mockServerUrl}/v2`, {
        autoOpen: false,
        timeoutMs: 10_000,
      });

      const startTime = Date.now();
      while (!localPayUrl && Date.now() - startTime < 4000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      assert(localPayUrl, 'Local payment server URL should have been printed for v2 challenge');

      // 1. Verify GET /pay serves HTML with amount and asset from v2 extra
      const payRes = await fetch(localPayUrl);
      assert.equal(payRes.status, 200);
      const payHtml = await payRes.text();
      assert(payHtml.includes('Lute Payment Approval'));
      assert(payHtml.includes('0.12 USDC'));

      // 2. Complete payment callback
      const completeUrl = localPayUrl.replace('/pay', '/api/complete');
      const completeRes = await fetch(completeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: testTxid }),
      });
      assert.equal(completeRes.status, 200);

      await getPromise;
      assert.equal(receivedTxid, testTxid);
    } finally {
      console.log = originalLog;
    }
  });
});
