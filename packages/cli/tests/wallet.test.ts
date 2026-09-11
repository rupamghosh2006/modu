import { describe, it } from 'node:test';
import assert from 'node:assert';
import algosdk from 'algosdk';

describe('Algorand Wallet Generation & Validation', () => {
  it('generates a valid Algorand keypair locally', () => {
    const account = algosdk.generateAccount();
    assert.ok(account.addr, 'Address should exist');
    assert.strictEqual(account.addr.length, 58, 'Algorand address must be 58 characters');
    assert.strictEqual(algosdk.isValidAddress(account.addr), true, 'Address must be valid checksum');

    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    assert.ok(mnemonic, 'Mnemonic must be generated');
    const words = mnemonic.trim().split(/\s+/);
    assert.strictEqual(words.length, 25, 'Algorand mnemonic must have 25 words');

    // Verify recovery
    const recovered = algosdk.mnemonicToSecretKey(mnemonic);
    assert.strictEqual(recovered.addr, account.addr, 'Recovered address must match');
  });

  it('rejects invalid or malformed Algorand addresses', () => {
    assert.strictEqual(algosdk.isValidAddress('invalid-address'), false);
    assert.strictEqual(algosdk.isValidAddress(''), false);
    assert.strictEqual(algosdk.isValidAddress('0x1234567890abcdef1234567890abcdef12345678'), false);
    // Modified checksum
    const account = algosdk.generateAccount();
    const corrupted = account.addr.slice(0, 57) + (account.addr[57] === 'A' ? 'B' : 'A');
    assert.strictEqual(algosdk.isValidAddress(corrupted), false);
  });
});
