import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { FastifyInstance } from 'fastify';
import { buildProxyServer } from '../src/server.js';

describe('Proxy In-Memory Endpoint Caching', () => {
  let mockControlPlane: http.Server;
  let cpUrl: string;
  let fetchCount = 0;
  let proxyApp: FastifyInstance;

  before(async () => {
    mockControlPlane = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      if (url.pathname === '/api/internal/endpoints/cached-slug') {
        fetchCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'ep_cached_123',
            slug: 'cached-slug',
            originUrl: 'http://127.0.0.1:9999',
            price: '0.001',
            asset: 'USDC',
            payoutAddress: 'TESTPAYOUTADDR',
            isActive: true,
          })
        );
        return;
      }

      if (url.pathname === '/api/internal/nonces') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockControlPlane.listen(0, '127.0.0.1', () => {
        const addr = mockControlPlane.address() as any;
        cpUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    proxyApp = buildProxyServer({
      controlPlaneUrl: cpUrl,
      proxyUrl: 'https://modu-proxy.onrender.com',
    });

    await proxyApp.ready();
  });

  after(async () => {
    await proxyApp.close();
    mockControlPlane.close();
  });

  it('caches endpoint lookups to avoid repeated control plane requests', async () => {
    assert.strictEqual(fetchCount, 0);

    // First request: should query control plane
    const res1 = await proxyApp.inject({
      method: 'GET',
      url: '/p/cached-slug',
    });
    assert.strictEqual(res1.statusCode, 402);
    assert.strictEqual(fetchCount, 1);

    // Second request: should use in-memory cache
    const res2 = await proxyApp.inject({
      method: 'GET',
      url: '/p/cached-slug',
    });
    assert.strictEqual(res2.statusCode, 402);
    assert.strictEqual(fetchCount, 1); // Still 1! Cached!

    // Third request: should also use in-memory cache
    const res3 = await proxyApp.inject({
      method: 'GET',
      url: '/p/cached-slug',
    });
    assert.strictEqual(res3.statusCode, 402);
    assert.strictEqual(fetchCount, 1); // Still 1!
  });
});
