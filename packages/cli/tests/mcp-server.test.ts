import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMcpServer } from '../src/mcp/server.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

describe('MCP Server (modu-x402) Unit Tests', () => {
  let mockProxyServer: http.Server;
  let mockProxyUrl: string;

  before(async () => {
    mockProxyServer = http.createServer((req, res) => {
      const payment = req.headers['x-payment'];
      if (!payment) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
                amount: '30000',
                asset: '10458941',
                payTo: 'YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A',
                maxTimeoutSeconds: 300,
                extra: {
                  name: 'USDC',
                  decimals: 6,
                },
              },
            ],
          })
        );
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-payment-response': JSON.stringify({
          status: 'settled',
          txid: 'SETTLED_TXID_MCP_99999',
          payer: 'PAYER_ADDR',
          amount: '30000',
          asset: '10458941',
        }),
      });
      res.end(JSON.stringify({ hello: 'from paid origin' }));
    });

    await new Promise<void>((resolve) => {
      mockProxyServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockProxyServer.address() as any;
    mockProxyUrl = `http://127.0.0.1:${addr.port}/p/mcp-test`;
  });

  after(() => {
    mockProxyServer.close();
  });

  it('lists call_paid_endpoint and wallet_info tools', async () => {
    const server = createMcpServer();
    const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    assert(handler, 'ListTools handler should be registered');

    const result = await handler({ method: 'tools/list', params: {} });
    assert.equal(result.tools.length, 2);

    const callTool = result.tools.find((t: any) => t.name === 'call_paid_endpoint');
    assert(callTool);
    assert(callTool.inputSchema.properties.url);
    assert(callTool.inputSchema.properties.confirm);

    const walletTool = result.tools.find((t: any) => t.name === 'wallet_info');
    assert(walletTool);
  });

  it('returns wallet_info with address and balance metadata', async () => {
    const server = createMcpServer({
      algodHost: 'http://127.0.0.1:9999', // dummy port to test graceful offline handling
    });
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    process.env.ALGORAND_MNEMONIC =
      'wire shuffle tiger resemble globe shift stay lift imitate logic spring mask alcohol speak garden method ribbon subject drama mango ice there tent about egg';

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'wallet_info',
        arguments: {},
      },
    });

    assert.equal(response.isError, undefined);
    assert.equal(response.content.length, 1);
    const parsed = JSON.parse(response.content[0].text);
    assert(parsed.address);
    assert.equal(parsed.role, 'Payer (signing wallet)');
  });

  it('prompts for confirmation on 402 challenge when MODU_MCP_AUTO_PAY is false', async () => {
    const server = createMcpServer();
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    process.env.MODU_MCP_AUTO_PAY = 'false';
    process.env.ALGORAND_MNEMONIC =
      'wire shuffle tiger resemble globe shift stay lift imitate logic spring mask alcohol speak garden method ribbon subject drama mango ice there tent about egg';

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'call_paid_endpoint',
        arguments: {
          url: mockProxyUrl,
        },
      },
    });

    assert.equal(response.isError, undefined);
    const text = response.content[0].text;
    assert(text.includes('⚠️ Payment Confirmation Required'));
    assert(text.includes('0.03 USDC'));
    assert(text.includes('YAVQWCPKM6D4HR63K7GYTR5AFR727RCA3VNWSMSJ7VTUJHNRRHEIIJJP4A'));
    assert(text.includes('"confirm": true'));
  });
});
