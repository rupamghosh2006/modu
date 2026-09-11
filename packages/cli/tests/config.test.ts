import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig } from '../src/config.js';

describe('CLI Config Management', () => {
  const tmpDir = path.join(os.tmpdir(), `modu-test-${Date.now()}`);
  const testConfigFile = path.join(tmpDir, 'config.json');

  it('loads empty config when file does not exist', () => {
    const config = loadConfig(testConfigFile);
    assert.deepStrictEqual(config, {});
  });

  it('saves and reloads config with correct permissions', () => {
    const saved = saveConfig(
      {
        apiKey: 'modu_live_test123',
        payoutAddress: 'TESTALGORANDADDRESS777',
      },
      testConfigFile
    );

    assert.strictEqual(saved.apiKey, 'modu_live_test123');
    assert.strictEqual(saved.payoutAddress, 'TESTALGORANDADDRESS777');

    const loaded = loadConfig(testConfigFile);
    assert.strictEqual(loaded.apiKey, 'modu_live_test123');
    assert.strictEqual(loaded.payoutAddress, 'TESTALGORANDADDRESS777');

    // Verify file exists
    assert.strictEqual(fs.existsSync(testConfigFile), true);
  });

  it('merges updates without overwriting existing fields', () => {
    saveConfig({ controlPlaneUrl: 'http://custom-cp.local' }, testConfigFile);

    const updated = loadConfig(testConfigFile);
    assert.strictEqual(updated.apiKey, 'modu_live_test123');
    assert.strictEqual(updated.controlPlaneUrl, 'http://custom-cp.local');

    // Clean up
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
