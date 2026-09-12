import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import algosdk from 'algosdk';
import { saveConfig, loadConfig } from '../src/config.js';
import { configCommand } from '../src/commands/config.js';
import { logInfo, logError, writeLog } from '../src/logger.js';

describe('Unified modu config Command', () => {
  let mockServer: http.Server;
  let serverUrl: string;
  const tmpDir = path.join(os.tmpdir(), `modu-config-test-${Date.now()}`);
  const configPath = path.join(tmpDir, 'config.json');
  const logPath = path.join(tmpDir, 'modu.log');

  let payoutAddressReceived = '';

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/api/account/me') {
        const auth = req.headers.authorization;
        if (auth === 'Bearer modu_live_test_config_token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'acc_test_123', email: 'dev@example.com' }));
          return;
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid API key' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/cli-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            token: 'tok_reauth_test',
            authUrl: `${serverUrl}/cli-auth?token=tok_reauth_test`,
            pollUrl: `${serverUrl}/api/auth/poll?token=tok_reauth_test`,
          })
        );
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/poll') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'claimed',
            apiKey: 'modu_live_test_config_token',
            payoutAddress: '',
          })
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/account/payout-address') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          payoutAddressReceived = parsed.payoutAddress;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, payoutAddress: payoutAddressReceived }));
        });
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

    // Seed test config with api key and control plane pointing to mock
    saveConfig(
      {
        apiKey: 'modu_live_test_config_token',
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

  it('configures payout address using modu config <address>', async () => {
    const testAccount = algosdk.generateAccount();
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await configCommand(testAccount.addr, {
      json: true,
      configPath,
    });
    console.log = origLog;

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.status, 'configured');
    assert.strictEqual(parsed.payoutAddress, testAccount.addr);
    assert.strictEqual(payoutAddressReceived, testAccount.addr);

    // Verify written to config file
    const loaded = loadConfig(configPath);
    assert.strictEqual(loaded.payoutAddress, testAccount.addr);
  });

  it('rejects invalid address in modu config', async () => {
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await configCommand('INVALID_ALGORAND_ADDRESS', {
      json: true,
      configPath,
    });
    console.log = origLog;
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = 0;

    const parsed = JSON.parse(stdout);
    assert.ok(parsed.error.includes('Invalid Algorand address'));
  });

  it('triggers browser re-authentication when saved API key is invalid', async () => {
    const badConfigPath = path.join(tmpDir, 'bad-config.json');
    saveConfig(
      {
        apiKey: 'invalid_expired_token',
        controlPlaneUrl: serverUrl,
      },
      badConfigPath
    );

    const testAccount = algosdk.generateAccount();
    let stdout = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    await configCommand(testAccount.addr, {
      json: true,
      autoOpen: false,
      pollIntervalMs: 50,
      configPath: badConfigPath,
    });
    console.log = origLog;

    const loaded = loadConfig(badConfigPath);
    assert.strictEqual(loaded.apiKey, 'modu_live_test_config_token');
    assert.strictEqual(loaded.payoutAddress, testAccount.addr);
  });

  it('writes logs into logfile on operations', () => {
    logInfo('TEST', 'Test message for logfile', { foo: 'bar' }, logPath);
    logError('TEST', 'Error logged for test', new Error('sample err'), logPath);

    assert.strictEqual(fs.existsSync(logPath), true);
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('[INFO] [TEST] Test message for logfile'));
    assert.ok(content.includes('"foo":"bar"'));
    assert.ok(content.includes('[ERROR] [TEST] Error logged for test'));
    assert.ok(content.includes('sample err'));
  });
});
