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
  /** Optional custom Algod client (useful for unit tests or custom nodes) */
  algodClient?: algosdk.Algodv2;
  /** Optional custom handler to send ALGO payment (useful for unit tests) */
  sendAlgoPayment?: (params: {
    from: string;
    to: string;
    amountMicro: string;
    network?: string;
    nonce?: string;
  }) => Promise<string>;
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
 * 5. For native ALGO payments: signs, broadcasts on Algorand, and settles with X-PAYMENT-TXID.
 * 6. For USDC payments: builds and signs atomic transaction group with X-PAYMENT header for facilitator settlement.
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

  const isAlgo =
    accept.asset === '0' ||
    accept.asset === 'ALGO' ||
    accept.extra?.name === 'ALGO';
  const amountMicro = accept.amount || accept.maxAmountRequired || '0';

  // 4. Confirmation gate
  if (opts?.confirmBeforePay) {
    const confirmed = await opts.confirmBeforePay(challenge);
    if (!confirmed) {
      throw new Error('Payment confirmation rejected or aborted by user');
    }
  }

  // 5. Authenticate and extract signing account
  let privateKey = process.env.AVM_PRIVATE_KEY;
  const mnemonic = opts?.mnemonic || process.env.ALGORAND_MNEMONIC;
  let account: algosdk.Account | null = null;

  if (mnemonic) {
    try {
      account = algosdk.mnemonicToSecretKey(mnemonic.trim());
      if (!privateKey) {
        privateKey = Buffer.from(account.sk).toString('base64');
      }
    } catch (err: any) {
      throw new Error(`Invalid ALGORAND_MNEMONIC: ${err.message || String(err)}`);
    }
  } else if (privateKey) {
    try {
      const skBytes = Buffer.from(privateKey, 'base64');
      account = {
        addr: algosdk.encodeAddress(skBytes.subarray(32, 64)),
        sk: skBytes,
      };
    } catch (err: any) {
      throw new Error(`Invalid AVM_PRIVATE_KEY: ${err.message || String(err)}`);
    }
  }

  if (!privateKey || !account) {
    throw new Error(
      'Either ALGORAND_MNEMONIC (25-word phrase) or AVM_PRIVATE_KEY (base64 key) is required to sign payments.'
    );
  }

  // 5a. Native ALGO payment flow (on-chain broadcast + X-PAYMENT-TXID)
  if (isAlgo) {
    let txid: string;
    if (opts?.sendAlgoPayment) {
      txid = await opts.sendAlgoPayment({
        from: account.addr.toString(),
        to: accept.payTo,
        amountMicro,
        network: accept.network,
        nonce: accept.nonce,
      });
    } else {
      const rawNetwork = accept.network || '';
      const isMainnet =
        rawNetwork.includes('wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=') ||
        rawNetwork === 'algorand-mainnet' ||
        rawNetwork === 'mainnet';
      const algodHost = isMainnet
        ? 'https://mainnet-api.algonode.cloud'
        : 'https://testnet-api.algonode.cloud';
      const algod = opts?.algodClient || new algosdk.Algodv2('', algodHost, 443);

      try {
        const sp = await algod.getTransactionParams().do();
        const note = accept.nonce
          ? new TextEncoder().encode(`modu:${accept.nonce}`)
          : new Uint8Array(0);
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: account.addr,
          to: accept.payTo,
          amount: BigInt(amountMicro),
          note,
          suggestedParams: sp,
        });
        const signedTxn = txn.signTxn(account.sk);
        const sendRes = await algod.sendRawTransaction(signedTxn).do();
        txid = sendRes.txId || sendRes.txid;
        await algosdk.waitForConfirmation(algod, txid, 5);
      } catch (err: any) {
        const msg = err.message || String(err);
        if (/balance|funds|overspend|below min|insufficient/i.test(msg)) {
          throw new Error(`Insufficient balance to complete payment: ${msg}`);
        }
        throw new Error(`Failed to broadcast ALGO payment transaction: ${msg}`);
      }
    }

    // Retry request with X-PAYMENT-TXID header
    let paidResponse: Response;
    try {
      paidResponse = await fetchFn(url, {
        method: 'GET',
        headers: {
          'X-PAYMENT-TXID': txid,
          Accept: 'application/json, text/plain, */*',
        },
      });
    } catch (err: any) {
      throw new Error(`Failed to send paid request to ${url}: ${err.message || String(err)}`);
    }

    if (paidResponse.status === 402) {
      let errorMsg = 'Payment verification failed at proxy';
      try {
        const errJson = (await paidResponse.json()) as any;
        errorMsg = errJson?.message || errJson?.error || errorMsg;
      } catch {
        const errText = await paidResponse.text().catch(() => '');
        if (errText) errorMsg = errText;
      }
      throw new Error(`Payment verification failure (402): ${errorMsg}`);
    }

    if (!paidResponse.ok) {
      const errText = await paidResponse.text().catch(() => '');
      throw new Error(
        `Paid request failed with HTTP ${paidResponse.status} ${paidResponse.statusText}: ${errText}`
      );
    }

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
      txid: receipt?.txid || txid,
      payer: receipt?.payer || account.addr.toString(),
      amount: receipt?.amount || amountMicro,
      asset: receipt?.asset || '0',
      responseBody,
    };
  }

  // 5b. ASA / USDC payment flow (x402 ExactAvmScheme via GoPlausible facilitator)
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
