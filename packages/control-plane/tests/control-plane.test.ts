import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import algosdk from 'algosdk';
import { buildServer } from '../src/server.js';
import { MemoryDataStore } from '../src/store.js';

describe('Control Plane API Endpoints', () => {
  let app: any;
  let serverUrl: string;

  let apiKey: string;
  let endpointId: string;
  const testAccount = algosdk.generateAccount();

  before(async () => {
    const store = new MemoryDataStore();
    app = buildServer({
      store,
    });
    serverUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  after(async () => {
    await app.close();
  });

  it('runs complete CLI login and claim flow', async () => {
    // 1. Request CLI token
    const tokenRes = await fetch(`${serverUrl}/api/auth/cli-token`, { method: 'POST' });
    assert.strictEqual(tokenRes.status, 200);
    const tokenData = (await tokenRes.json()) as any;
    assert.ok(tokenData.token);
    assert.ok(tokenData.authUrl);
    assert.ok(tokenData.pollUrl);

    // 2. Poll before claim -> pending
    const poll1 = await fetch(tokenData.pollUrl);
    const poll1Data = (await poll1.json()) as any;
    assert.strictEqual(poll1Data.status, 'pending');

    // 3. User claims token in browser
    const claimRes = await fetch(`${serverUrl}/api/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenData.token, email: 'dev@modu.test' }),
    });
    assert.strictEqual(claimRes.status, 200);

    // 4. Poll after claim -> claimed with API key
    const poll2 = await fetch(tokenData.pollUrl);
    const poll2Data = (await poll2.json()) as any;
    assert.strictEqual(poll2Data.status, 'claimed');
    assert.ok(poll2Data.apiKey.startsWith('modu_live_'));
    apiKey = poll2Data.apiKey;
  });

  it('connects developer payout address', async () => {
    const res = await fetch(`${serverUrl}/api/account/payout-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ payoutAddress: testAccount.addr }),
    });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.payoutAddress, testAccount.addr);
  });

  it('registers a new endpoint', async () => {
    const res = await fetch(`${serverUrl}/api/endpoints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        originUrl: 'https://api.openai.com/v1/models',
        price: '0.005',
        asset: 'USDC',
        path: 'openai-models',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    endpointId = data.endpointId;
    assert.ok(endpointId);
    assert.strictEqual(data.slug, 'openai-models');
    assert.strictEqual(data.price, '0.005');
    assert.strictEqual(data.asset, 'USDC');
    assert.strictEqual(data.payoutAddress, testAccount.addr);
    assert.ok(data.proxyUrl.endsWith('/p/openai-models'));
  });

  it('lists registered endpoints', async () => {
    const res = await fetch(`${serverUrl}/api/endpoints`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.strictEqual(res.status, 200);
    const list = (await res.json()) as any[];
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, endpointId);
    assert.strictEqual(list[0].isActive, true);
  });

  it('records logs and retrieves stats', async () => {
    // Record log via internal API
    const logRes = await fetch(`${serverUrl}/api/internal/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpointId,
        payerAddress: 'PAYER11111111111111111111111111111111111111111111111111',
        txid: 'TX_SAMPLE_123',
        amount: '5000', // 0.005 USDC in micro
        status: 200,
        latencyMs: 38,
      }),
    });
    assert.strictEqual(logRes.status, 200);

    // Retrieve stats
    const statsRes = await fetch(`${serverUrl}/api/endpoints/${endpointId}/stats`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.strictEqual(statsRes.status, 200);
    const stats = (await statsRes.json()) as any;
    assert.strictEqual(stats.totalRequests, 1);
    assert.strictEqual(stats.paidRequests, 1);
    assert.strictEqual(stats.totalRevenue, '0.005');
  });

  it('revokes an endpoint', async () => {
    const delRes = await fetch(`${serverUrl}/api/endpoints/${endpointId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.strictEqual(delRes.status, 200);

    // Verify endpoint is revoked in internal proxy lookup
    const lookupRes = await fetch(`${serverUrl}/api/internal/endpoints/${endpointId}`);
    assert.strictEqual(lookupRes.status, 200);
    const ep = (await lookupRes.json()) as any;
    assert.strictEqual(ep.isActive, false);
  });
});
