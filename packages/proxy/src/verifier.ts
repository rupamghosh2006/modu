/**
 * @deprecated Legacy local Algorand payment verifier and indexer client.
 *
 * Modu's primary payment flow has migrated to the official x402 v2 "exact" AVM scheme
 * backed by the GoPlausible facilitator (https://facilitator.goplausible.xyz).
 *
 * This verifier is retained for:
 * 1. Backwards-compatibility in environments without external facilitator connectivity
 *    (activated via USE_LOCAL_VERIFIER=true).
 * 2. Standalone testing and local indexer transaction verification.
 */

import {
  ALGORAND_ALGO_ASSET_ID,
  ALGORAND_TESTNET_USDC_ASA_ID,
  DEFAULT_INDEXER_URL,
  decodeNote,
} from '@modu/shared';

export interface VerifyPaymentParams {
  txid: string;
  expectedReceiver: string;
  expectedAmountMicro: string;
  expectedAsset: string; // "10458941" or "0"
  expectedNonce?: string;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  payer?: string;
  amount?: string;
  asset?: string;
  confirmedRound?: number;
  nonce?: string;
}

export interface IndexerClient {
  getTransaction(txid: string): Promise<any>;
}

export class AlgonodeIndexerClient implements IndexerClient {
  constructor(private baseUrl: string = DEFAULT_INDEXER_URL) {}

  async getTransaction(txid: string): Promise<any> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v2/transactions/${encodeURIComponent(txid)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return null;
      }
      throw new Error(`Indexer returned status ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    return data.transaction || null;
  }
}

export class AlgorandPaymentVerifier {
  constructor(private indexerClient: IndexerClient = new AlgonodeIndexerClient()) {}

  async verify(params: VerifyPaymentParams): Promise<VerificationResult> {
    const { txid, expectedReceiver, expectedAmountMicro, expectedAsset, expectedNonce } = params;

    let tx: any;
    try {
      tx = await this.indexerClient.getTransaction(txid);
    } catch (err: any) {
      return {
        valid: false,
        error: `Failed to query Algorand indexer: ${err.message}`,
      };
    }

    if (!tx) {
      return {
        valid: false,
        error: `Transaction ${txid} not found on-chain. Please wait for confirmation.`,
      };
    }

    // 1. Confirmed round
    const confirmedRound = tx['confirmed-round'];
    if (!confirmedRound || confirmedRound <= 0) {
      return {
        valid: false,
        error: `Transaction ${txid} is not confirmed yet (round ${confirmedRound})`,
      };
    }

    const payer = tx.sender;

    // 2. Validate payment type, receiver, and amount
    let receiver = '';
    let amount = '0';
    let asset = '0';

    const isAlgo = expectedAsset === ALGORAND_ALGO_ASSET_ID;

    if (isAlgo) {
      if (tx['tx-type'] !== 'pay' || !tx['payment-transaction']) {
        return {
          valid: false,
          error: `Expected ALGO payment transaction ('pay'), found '${tx['tx-type']}'`,
        };
      }
      receiver = tx['payment-transaction'].receiver;
      amount = String(tx['payment-transaction'].amount || 0);
      asset = ALGORAND_ALGO_ASSET_ID;
    } else {
      // ASA payment (USDC)
      if (tx['tx-type'] !== 'axfer' || !tx['asset-transfer-transaction']) {
        return {
          valid: false,
          error: `Expected asset transfer transaction ('axfer'), found '${tx['tx-type']}'`,
        };
      }
      const assetTx = tx['asset-transfer-transaction'];
      const assetId = String(assetTx['asset-id']);
      if (assetId !== expectedAsset) {
        return {
          valid: false,
          error: `Asset ID mismatch: expected ${expectedAsset}, found ${assetId}`,
        };
      }
      receiver = assetTx.receiver;
      amount = String(assetTx.amount || 0);
      asset = assetId;
    }

    // Check receiver
    if (receiver !== expectedReceiver) {
      return {
        valid: false,
        error: `Payment receiver mismatch: expected ${expectedReceiver}, found ${receiver}`,
      };
    }

    // Check amount
    if (BigInt(amount) < BigInt(expectedAmountMicro)) {
      return {
        valid: false,
        error: `Insufficient payment amount: received ${amount}, required ${expectedAmountMicro}`,
      };
    }

    // 3. Note verification (challenge nonce)
    let noteNonce: string | undefined;
    if (tx.note) {
      noteNonce = decodeNote(tx.note);
    }

    if (expectedNonce && noteNonce !== expectedNonce) {
      return {
        valid: false,
        error: `Challenge nonce mismatch in transaction note. Note was '${noteNonce || ''}'`,
      };
    }

    return {
      valid: true,
      payer,
      amount,
      asset,
      confirmedRound,
      nonce: noteNonce,
    };
  }
}
