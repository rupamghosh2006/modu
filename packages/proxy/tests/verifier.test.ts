import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AlgorandPaymentVerifier, IndexerClient } from '../src/verifier.js';
import { ALGORAND_TESTNET_USDC_ASA_ID, ALGORAND_ALGO_ASSET_ID, encodeNote } from '@modu/shared';

class MockIndexerClient implements IndexerClient {
  public transactions = new Map<string, any>();

  async getTransaction(txid: string): Promise<any> {
    return this.transactions.get(txid) || null;
  }
}

describe('Algorand Payment Verifier', () => {
  const indexer = new MockIndexerClient();
  const verifier = new AlgorandPaymentVerifier(indexer);

  const testReceiver = 'RECEIVERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const testPayer = 'PAYERADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const testNonce = 'nonce1234567890';

  it('validates a correct Algorand USDC ASA transfer', async () => {
    const txid = 'TX_USDC_OK';
    const noteBase64 = Buffer.from(encodeNote(testNonce)).toString('base64');

    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 39000000,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: testReceiver,
        amount: 10000, // 0.01 USDC
      },
      note: noteBase64,
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '10000',
      expectedAsset: ALGORAND_TESTNET_USDC_ASA_ID,
      expectedNonce: testNonce,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payer, testPayer);
    assert.strictEqual(result.amount, '10000');
    assert.strictEqual(result.asset, ALGORAND_TESTNET_USDC_ASA_ID);
    assert.strictEqual(result.nonce, testNonce);
  });

  it('validates a correct native ALGO payment', async () => {
    const txid = 'TX_ALGO_OK';
    const noteBase64 = Buffer.from(encodeNote(testNonce)).toString('base64');

    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 39000001,
      sender: testPayer,
      'tx-type': 'pay',
      'payment-transaction': {
        receiver: testReceiver,
        amount: 1000000, // 1 ALGO
      },
      note: noteBase64,
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '1000000',
      expectedAsset: ALGORAND_ALGO_ASSET_ID,
      expectedNonce: testNonce,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payer, testPayer);
    assert.strictEqual(result.amount, '1000000');
    assert.strictEqual(result.asset, ALGORAND_ALGO_ASSET_ID);
  });

  it('rejects unconfirmed transaction', async () => {
    const txid = 'TX_UNCONFIRMED';
    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 0, // not confirmed
      sender: testPayer,
      'tx-type': 'pay',
      'payment-transaction': {
        receiver: testReceiver,
        amount: 1000000,
      },
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '1000000',
      expectedAsset: ALGORAND_ALGO_ASSET_ID,
    });

    assert.strictEqual(result.valid, false);
    assert.match(result.error || '', /not confirmed/);
  });

  it('rejects transaction with mismatched receiver', async () => {
    const txid = 'TX_WRONG_RECEIVER';
    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 100,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: 'WRONGRECEIVERADDRESS',
        amount: 10000,
      },
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '10000',
      expectedAsset: ALGORAND_TESTNET_USDC_ASA_ID,
    });

    assert.strictEqual(result.valid, false);
    assert.match(result.error || '', /receiver mismatch/);
  });

  it('rejects transaction with insufficient amount', async () => {
    const txid = 'TX_INSUFFICIENT';
    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 100,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: testReceiver,
        amount: 5000, // only 0.005 USDC
      },
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '10000',
      expectedAsset: ALGORAND_TESTNET_USDC_ASA_ID,
    });

    assert.strictEqual(result.valid, false);
    assert.match(result.error || '', /Insufficient payment amount/);
  });

  it('rejects transaction with mismatched challenge nonce', async () => {
    const txid = 'TX_WRONG_NONCE';
    const wrongNote = Buffer.from(encodeNote('different_nonce')).toString('base64');

    indexer.transactions.set(txid, {
      id: txid,
      'confirmed-round': 100,
      sender: testPayer,
      'tx-type': 'axfer',
      'asset-transfer-transaction': {
        'asset-id': parseInt(ALGORAND_TESTNET_USDC_ASA_ID, 10),
        receiver: testReceiver,
        amount: 10000,
      },
      note: wrongNote,
    });

    const result = await verifier.verify({
      txid,
      expectedReceiver: testReceiver,
      expectedAmountMicro: '10000',
      expectedAsset: ALGORAND_TESTNET_USDC_ASA_ID,
      expectedNonce: testNonce,
    });

    assert.strictEqual(result.valid, false);
    assert.match(result.error || '', /Challenge nonce mismatch/);
  });
});
