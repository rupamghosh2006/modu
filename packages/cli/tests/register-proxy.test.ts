import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { saveConfig } from '../src/config.js';
import { registerCommand } from '../src/commands/register.js';
import { listCommand } from '../src/commands/list.js';

describe('Register and List Proxy URL Formatting & Logging', () => {
  let mockServer: http.Server;
  let serverUrl: string;
  const tmpDir = path.join(os.tmpdir(), `modu-proxy-test-${Date.now()}`);
  const configPath = path.join(tmpDir, 'config.json');
  const logPath = path.join(tmpDir, 'modu.log');

  before(async () => {
    process.env.MODU_LOG_FILE = logPath;

    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (req.method === 'POST' && url.pathname === '/api/endpoints') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          // Mock server returns old localhost:4000 URL
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              endpointId: 'ep_test_proxy_fix',
              slug: parsed.path || 'my-fixed-endpoint',
              proxyUrl: `http://localhost:4000/p/${parsed.path || 'my-fixed-endpoint'}`,
              originUrl: parsed.originUrl,
              price: parsed.price,
              asset: parsed.asset,
              payoutAddress: 'TESTPAYOUTADDR',
            })
          );
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/endpoints') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'ep_test_proxy_fix',
              slug: 'my-fixed-endpoint',
              proxyUrl: 'http://localhost:4000/p/my-fixed-endpoint',
              originUrl: 'https://httpbin.org/get',
              price: '0.001',
              asset: 'USDC',
              requestsToday: 0,
              revenueToday: '0',
              isActive: true,
            },
          ])
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

    saveConfig(
      {
        apiKey: 'modu_live_test_proxy_token',
        controlPlaneUrl: serverUrl,
        proxyUrl: 'https://modu-proxy.onrender.com',
      },
      configPath
    );
  });

  after(() => {
    mockServer.close();
    delete process.env.MODU_LOG_FILE;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('rewrites localhost:4000 to configured proxy url on register', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await registerCommand({
      url: 'https://httpbin.org/get',
      price: '0.001',
      asset: 'USDC',
      path: 'my-fixed-endpoint',
      json: true,
      configPath,
      skipReachabilityCheck: true,
    });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.endpointId, 'ep_test_proxy_fix');
    assert.strictEqual(parsed.slug, 'my-fixed-endpoint');
    assert.strictEqual(parsed.proxyUrl, 'https://modu-proxy.onrender.com/p/my-fixed-endpoint');

    // Verify logfile contains entry
    assert.strictEqual(fs.existsSync(logPath), true);
    const logContent = fs.readFileSync(logPath, 'utf8');
    assert.ok(logContent.includes('[INFO] [REGISTER] Initiating endpoint registration'));
    assert.ok(logContent.includes('[INFO] [REGISTER] Endpoint registered successfully'));
  });

  it('rewrites localhost:4000 to configured proxy url on list', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await listCommand({
      json: true,
      configPath,
    });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].proxyUrl, 'https://modu-proxy.onrender.com/p/my-fixed-endpoint');
  });
});
