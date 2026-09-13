/**
 * Reference Consumer Script for modu x402 v2 Facilitator Payments
 *
 * In x402 v2 (GoPlausible Facilitator):
 * 1. The consumer receives an HTTP 402 challenge with x402 v2 PaymentRequirements.
 * 2. The consumer builds an atomic transaction group client-side:
 *    - Transaction 0: Signed ASA transfer
 *    - Transaction 1: Unsigned fee-payer transaction (covered by the facilitator)
 * 3. The consumer sends the base64-encoded PaymentPayload via the `X-PAYMENT` header.
 * 4. The proxy calls the GoPlausible Facilitator to verify (simulate) and settle
 *    (co-sign the fee-payer transaction and broadcast to Algorand).
 * 5. The origin API response is streamed back with `X-PAYMENT-RESPONSE`.
 *
 * Usage:
 *   export ALGORAND_MNEMONIC="word1 word2 ... word25"
 *   npx tsx examples/pay-example.ts https://modu-proxy.onrender.com/p/my-endpoint
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callPaidEndpoint, registerExactAvmScheme } from '../packages/cli/src/lib/payClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { registerExactAvmScheme };

async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    try {
      process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
    } catch {}
  }

  const targetUrl =
    process.argv[2] || process.env.ENDPOINT_URL || 'http://localhost:4000/p/my-endpoint';

  console.log(`\nCalling endpoint: ${targetUrl}`);

  const result = await callPaidEndpoint(targetUrl, {
    mnemonic: process.env.ALGORAND_MNEMONIC,
  });

  if (result.settled) {
    console.log('\nSettlement Receipt (X-PAYMENT-RESPONSE):');
    console.log(
      JSON.stringify(
        {
          status: 'settled',
          txid: result.txid,
          payer: result.payer,
          amount: result.amount,
          asset: result.asset,
        },
        null,
        2
      )
    );
  } else {
    console.log('\nEndpoint returned 200 OK without requiring payment.');
  }

  console.log('\nResponse Body:');
  if (typeof result.responseBody === 'object' && result.responseBody !== null) {
    console.log(JSON.stringify(result.responseBody, null, 2));
  } else {
    console.log(result.responseBody);
  }
}

if (process.argv[1]?.includes('pay-example')) {
  main().catch((err) => {
    console.error('Payment failed:', err.message || err);
    process.exit(1);
  });
}
