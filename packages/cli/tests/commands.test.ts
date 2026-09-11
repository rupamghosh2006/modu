import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import algosdk from 'algosdk';
import { saveConfig } from '../src/config.js';
import { walletConnectCommand } from '../src/commands/wallet.js';
import { registerCommand } from '../src/commands/register.js';
import { listCommand } from '../src/commands/list.js';
import { revokeCommand } from '../src/commands/revoke.js';
import { statsCommand } from '../src/commands/stats.js';

describe('CLI Integration with Control Plane', () => {
  let mockServer: http.Server;
  let serverUrl: string;
  const tmpDir = path.join(os.tmpdir(), `modu-cli-test-${Date.now()}`);
  const configPath = path.join(tmpDir, 'config.json');

  const registeredEndpoints: any[] = [];
  let payoutAddressSet = '';

  before(async () => {
    // Spin up mock control plane server
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (req.method === 'POST' && url.pathname === '/api/account/payout-address') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          payoutAddressSet = parsed.payoutAddress;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, payoutAddress: payoutAddressSet }));
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/endpoints') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          const ep = {
            endpointId: 'ep_test123',
            slug: parsed.path || 'test-ep',
            proxyUrl: `http://localhost:4000/p/${parsed.path || 'test-ep'}`,
            originUrl: parsed.originUrl,
            price: parsed.price,
            asset: parsed.asset,
            payoutAddress: payoutAddressSet,
            isActive: true,
            requestsToday: 0,
            revenueToday: '0',
          };
          registeredEndpoints.push(ep);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ep));
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/endpoints') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(registeredEndpoints));
        return;
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/endpoints/')) {
        const id = url.pathname.split('/').pop();
        const ep = registeredEndpoints.find((e) => e.endpointId === id);
        if (ep) ep.isActive = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, endpointId: id, status: 'revoked' }));
        return;
      }

      if (req.method === 'GET' && url.pathname.endsWith('/stats')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            endpointId: 'ep_test123',
            totalRequests: 10,
            paidRequests: 8,
            totalRevenue: '0.08',
            revenueToday: '0.04',
            requestsToday: 4,
            revenueByDay: [{ date: '2026-09-12', amount: '0.04', requests: 4 }],
            topPayers: [{ address: 'ALGORANDTESTPAYER', requests: 4, totalAmount: '0.04' }],
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as any;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Save initial config with apiKey pointing to mock server
    saveConfig(
      {
        apiKey: 'modu_live_mock_key',
        controlPlaneUrl: serverUrl,
      },
      configPath
    );
  });

  after(() => {
    mockServer.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('connects a payout address to control plane', async () => {
    const testAccount = algosdk.generateAccount();
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await walletConnectCommand(testAccount.addr, { json: true, configPath });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.payoutAddress, testAccount.addr);
    assert.strictEqual(payoutAddressSet, testAccount.addr);
  });

  it('registers a new endpoint with --json', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await registerCommand({
      url: 'https://httpbin.org/get',
      price: '0.01',
      asset: 'USDC',
      path: 'my-test-api',
      json: true,
      configPath,
      skipReachabilityCheck: true,
    });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.endpointId, 'ep_test123');
    assert.strictEqual(parsed.slug, 'my-test-api');
    assert.strictEqual(parsed.price, '0.01');
    assert.strictEqual(parsed.asset, 'USDC');
  });

  it('lists registered endpoints with --json', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await listCommand({ json: true, configPath });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(Array.isArray(parsed), true);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].endpointId, 'ep_test123');
  });

  it('revokes an endpoint with --json', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await revokeCommand('ep_test123', { json: true, configPath });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.status, 'revoked');
  });

  it('retrieves stats for an endpoint with --json', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await statsCommand('ep_test123', { json: true, configPath });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.endpointId, 'ep_test123');
    assert.strictEqual(parsed.paidRequests, 8);
    assert.strictEqual(parsed.totalRevenue, '0.08');
  });
});
