import { x402Client } from '@x402/core/client';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner } from '@x402/avm';
import algosdk from 'algosdk';

export interface PaymentAccept {
  scheme: string;
  network: string;
  amount?: string;
  maxAmountRequired?: string;
  asset: string;
  payTo: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  nonce?: string;
  outputSchema?: Record<string, unknown> | null;
  extra?: {
    name?: string;
    decimals?: number;
    feePayer?: string;
    [key: string]: unknown;
  };
}

export interface X402Challenge {
  x402Version: number;
  error?: string;
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  accepts: PaymentAccept[];
  extensions?: Record<string, unknown>;
}

export interface CallPaidEndpointOptions {
  mnemonic?: string;
  confirmBeforePay?: (challenge: X402Challenge) => Promise<boolean>;
  /** Optional override for x402Client (useful for unit tests or custom scheme config) */
  client?: x402Client;
  /** Custom fetch implementation (useful for unit tests) */
  fetch?: typeof globalThis.fetch;
}

export interface CallPaidEndpointResult {
  settled: boolean;
  txid?: string;
  payer?: string;
  amount?: string;
  asset?: string;
  responseBody: unknown;
}

/**
 * Helper to register the Exact AVM scheme with an x402Client instance
 */
export function registerExactAvmScheme(client: x402Client, signer: any): x402Client {
  return client.register('algorand:*', new ExactAvmScheme(signer));
}

/**
 * Calls a modu x402-gated endpoint.
 *
 * 1. Makes an initial unauthenticated request.
 * 2. If 200, returns the response body immediately with settled: false.
 * 3. If 402, parses and validates the x402 challenge.
 * 4. Calls opts.confirmBeforePay (if provided) and aborts if it returns false.
 * 5. Builds and signs an Algorand atomic transaction group payload (USDC ASA transfer + unsigned fee-payer txn).
 * 6. Retries the request with base64 X-PAYMENT header for GoPlausible facilitator settlement.
 * 7. Returns the settlement receipt and origin response body.
 *
 * Throws descriptive errors for 404 (endpoint not found), invalid/expired challenge,
 * insufficient balance, and facilitator verify/settle failures.
 */
export async function callPaidEndpoint(
  url: string,
  opts?: CallPaidEndpointOptions
): Promise<CallPaidEndpointResult> {
  const fetchFn = opts?.fetch || globalThis.fetch;

  // 1. Initial unauthenticated request
  let initialResponse: Response;
  try {
    initialResponse = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });
  } catch (err: any) {
    throw new Error(`Failed to reach endpoint ${url}: ${err.message || String(err)}`);
  }

  // 2. Handle non-402 outcomes
  if (initialResponse.status === 404) {
    const text = await initialResponse.text().catch(() => '');
    throw new Error(`Endpoint not found (404): ${url}${text ? ` - ${text}` : ''}`);
  }

  if (initialResponse.status === 410) {
    const text = await initialResponse.text().catch(() => '');
    throw new Error(`Endpoint revoked (410): ${url}${text ? ` - ${text}` : ''}`);
  }

  if (initialResponse.ok) {
    const contentType = initialResponse.headers.get('content-type') || '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      responseBody = await initialResponse.json().catch(() => null);
    } else {
      responseBody = await initialResponse.text().catch(() => '');
    }
    return {
      settled: false,
      responseBody,
    };
  }

  if (initialResponse.status !== 402) {
    const text = await initialResponse.text().catch(() => '');
    throw new Error(
      `Endpoint request failed with HTTP ${initialResponse.status} ${initialResponse.statusText}: ${text}`
    );
  }

  // 3. Parse and validate 402 challenge
  let challenge: X402Challenge;
  try {
    challenge = (await initialResponse.json()) as X402Challenge;
  } catch (err: any) {
    throw new Error(
      `Invalid or malformed x402 challenge: Response is not valid JSON (${err.message || String(err)})`
    );
  }

  if (!challenge || typeof challenge !== 'object') {
    throw new Error('Invalid or malformed x402 challenge: Response body is not an object');
  }

  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    throw new Error('Invalid or malformed x402 challenge: Missing or empty accepts array');
  }

  const accept = challenge.accepts[0];
  if (!accept || typeof accept !== 'object') {
    throw new Error('Invalid or malformed x402 challenge: Invalid accept entry in challenge');
  }

  if (!accept.payTo || (!accept.amount && !accept.maxAmountRequired)) {
    throw new Error(
      'Invalid or malformed x402 challenge: Missing required fields (payTo, amount)'
    );
  }

  // Reject native ALGO challenges — GoPlausible facilitator standard requires ASA (USDC)
  if (accept.asset === '0' || accept.extra?.name === 'ALGO') {
    throw new Error(
      'Endpoint requires native ALGO payment, which is not supported by the x402 facilitator. ' +
      'Please use a USDC-denominated endpoint or the browser Lute wallet flow (modu get).'
    );
  }

  // 4. Confirmation gate
  if (opts?.confirmBeforePay) {
    const confirmed = await opts.confirmBeforePay(challenge);
    if (!confirmed) {
      throw new Error('Payment confirmation rejected or aborted by user');
    }
  }

  // 5. Build and sign atomic transaction group
  let privateKey = process.env.AVM_PRIVATE_KEY;
  const mnemonic = opts?.mnemonic || process.env.ALGORAND_MNEMONIC;

  if (!privateKey && mnemonic) {
    try {
      const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
      privateKey = Buffer.from(account.sk).toString('base64');
    } catch (err: any) {
      throw new Error(`Invalid ALGORAND_MNEMONIC: ${err.message || String(err)}`);
    }
  }

  if (!privateKey) {
    throw new Error(
      'Either ALGORAND_MNEMONIC (25-word phrase) or AVM_PRIVATE_KEY (base64 key) is required to sign payments.'
    );
  }

  let paymentPayload: any;
  try {
    const client = opts?.client || new x402Client();
    if (!opts?.client) {
      const signer = toClientAvmSigner(privateKey);
      client.setSpendControls(false);
      registerExactAvmScheme(client, signer);
    }
    paymentPayload = await client.createPaymentPayload(challenge as any);
  } catch (err: any) {
    const msg = err.message || String(err);
    if (/balance|funds|overspend|below min|insufficient/i.test(msg)) {
      throw new Error(`Insufficient balance to complete payment: ${msg}`);
    }
    throw new Error(`Failed to create payment transaction: ${msg}`);
  }

  // 6. Retry request with base64 X-PAYMENT header
  const paymentHeaderValue = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  let paidResponse: Response;
  try {
    paidResponse = await fetchFn(url, {
      method: 'GET',
      headers: {
        'X-PAYMENT': paymentHeaderValue,
        Accept: 'application/json, text/plain, */*',
      },
    });
  } catch (err: any) {
    throw new Error(`Failed to send paid request to ${url}: ${err.message || String(err)}`);
  }

  // 7. Check retry response
  if (paidResponse.status === 402) {
    let errorMsg = 'Payment verification or settlement failed at facilitator';
    try {
      const errJson = (await paidResponse.json()) as any;
      errorMsg = errJson?.message || errJson?.error || errorMsg;
    } catch {
      const errText = await paidResponse.text().catch(() => '');
      if (errText) errorMsg = errText;
    }
    throw new Error(`Facilitator verify/settle failure (402): ${errorMsg}`);
  }

  if (!paidResponse.ok) {
    const errText = await paidResponse.text().catch(() => '');
    throw new Error(
      `Paid request failed with HTTP ${paidResponse.status} ${paidResponse.statusText}: ${errText}`
    );
  }

  // 8. Extract settlement receipt and response body
  const settlementReceiptHeader = paidResponse.headers.get('x-payment-response');
  let receipt: any = null;
  if (settlementReceiptHeader) {
    try {
      receipt = JSON.parse(settlementReceiptHeader);
    } catch {
      // ignore JSON parse error on receipt header
    }
  }

  const contentType = paidResponse.headers.get('content-type') || '';
  let responseBody: unknown;
  if (contentType.includes('application/json')) {
    responseBody = await paidResponse.json().catch(() => null);
  } else {
    responseBody = await paidResponse.text().catch(() => '');
  }

  return {
    settled: true,
    txid: receipt?.txid,
    payer: receipt?.payer,
    amount: receipt?.amount,
    asset: receipt?.asset,
    responseBody,
  };
}
