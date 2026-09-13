/**
 * Reference Consumer Script for modu x402 v2 Facilitator Payments
 *
 * BREAKING CHANGE:
 * Previously, modu consumers had to broadcast a transaction directly on Algorand
 * with a `modu:<nonce>` note and send `X-PAYMENT-TXID: <txid>`.
 *
 * In x402 v2 (GoPlausible Facilitator):
 * 1. The consumer receives an HTTP 402 challenge with x402 v2 PaymentRequirements.
 * 2. The consumer builds an atomic transaction group client-side:
 *    - Transaction 0: Signed ASA transfer or ALGO payment
 *    - Transaction 1: Unsigned fee-payer transaction (covered by the facilitator)
 * 3. The consumer sends the base64-encoded PaymentPayload via the `X-PAYMENT` header.
 * 4. The proxy calls the GoPlausible Facilitator to verify (simulate) and settle
 *    (co-sign the fee-payer transaction and broadcast to Algorand).
 * 5. The origin API response is streamed back with `X-PAYMENT-RESPONSE`.
 *
 * Usage:
 *   export AVM_PRIVATE_KEY="<base64-encoded-64-byte-private-key>"
 *   npx tsx examples/pay-example.ts https://your-proxy.example.com/p/my-endpoint
 */

import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { toClientAvmSigner } from '@x402/avm';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import algosdk from 'algosdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Convenience helper to register the Exact AVM scheme with x402Client
 */
export function registerExactAvmScheme(client: x402Client, signer: any): x402Client {
  return client.register('algorand:*', new ExactAvmScheme(signer));
}

async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    try {
      process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
    } catch {}
  }

  const targetUrl = process.argv[2] || process.env.ENDPOINT_URL || 'http://localhost:4000/p/my-endpoint';
  let privateKey = process.env.AVM_PRIVATE_KEY;
  const mnemonic = process.env.ALGORAND_MNEMONIC;

  if (!privateKey && mnemonic) {
    try {
      const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
      privateKey = Buffer.from(account.sk).toString('base64');
    } catch (err: any) {
      console.error('Error parsing ALGORAND_MNEMONIC:', err.message);
      process.exit(1);
    }
  }

  if (!privateKey) {
    console.error('Error: Either ALGORAND_MNEMONIC (25-word phrase) or AVM_PRIVATE_KEY (base64 key) is required.');
    console.error('Example:');
    console.error('  export ALGORAND_MNEMONIC="word1 word2 ... word25"');
    console.error('  npx tsx examples/pay-example.ts http://localhost:4000/p/my-endpoint');
    process.exit(1);
  }

  console.log(`\n[1/4] Requesting resource without payment: ${targetUrl}`);
  const initialResponse = await fetch(targetUrl);

  if (initialResponse.status !== 402) {
    console.log(`Endpoint returned HTTP ${initialResponse.status} (no payment required or error).`);
    const text = await initialResponse.text();
    console.log(text);
    return;
  }

  console.log('\n[2/4] Received HTTP 402 Payment Required challenge:');
  const challenge = await initialResponse.json() as any;
  console.log(JSON.stringify(challenge, null, 2));

  const accept = challenge.accepts?.[0];
  if (accept && (accept.asset === '0' || accept.extra?.name === 'ALGO')) {
    console.error('\n⚠️  Notice: The GoPlausible x402 Facilitator standard is designed for Algorand Standard Assets (USDC ASA 10458941), not native ALGO.');
    console.error('To pay for this ALGO-denominated endpoint, use the browser Lute wallet flow:');
    console.error(`  modu get ${targetUrl}`);
    console.error('\nTo test with this automated x402 facilitator script, call a USDC endpoint:');
    console.error('  npx tsx examples/pay-example.ts https://modu-proxy.onrender.com/p/test-usdc');
    return;
  }

  // Initialize client-side signer and x402 payment client
  const signer = toClientAvmSigner(privateKey);
  console.log(`\n[3/4] Initialized Algorand client signer for address: ${signer.address}`);

  const client = new x402Client();
  // Allow Algorand native ALGO and ASA tokens by disabling or relaxing spendControls
  client.setSpendControls(false);
  registerExactAvmScheme(client, signer);

  // Generate atomic payment transaction group payload
  console.log('Building and signing atomic transaction group...');
  const paymentPayload = await client.createPaymentPayload(challenge);

  // Encode as base64 JSON payload for X-PAYMENT header
  const paymentHeaderValue = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.log('\n[4/4] Sending request with X-PAYMENT header (facilitator settle)...');
  const paidResponse = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'X-PAYMENT': paymentHeaderValue,
      'Accept': 'application/json',
    },
  });

  console.log(`HTTP Status: ${paidResponse.status} ${paidResponse.statusText}`);

  const settlementReceipt = paidResponse.headers.get('x-payment-response');
  if (settlementReceipt) {
    console.log('\nSettlement Receipt (X-PAYMENT-RESPONSE):');
    console.log(JSON.stringify(JSON.parse(settlementReceipt), null, 2));
  }

  const body = await paidResponse.text();
  console.log('\nResponse Body:');
  console.log(body);
}

if (process.argv[1]?.includes('pay-example')) {
  main().catch((err) => {
    console.error('Payment failed:', err);
    process.exit(1);
  });
}
