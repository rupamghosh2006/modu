import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import algosdk from 'algosdk';
import { callPaidEndpoint, X402Challenge } from '../lib/payClient.js';
import { fromBaseUnits } from '../shared.js';
import { loadConfig } from '../config.js';

// Auto-load .env if available
try {
  process.loadEnvFile?.();
} catch {
  // ignore
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  algodHost?: string;
}

/**
 * Creates and configures the modu-x402 Model Context Protocol (MCP) server
 */
export function createMcpServer(options: McpServerOptions = {}): Server {
  const server = new Server(
    {
      name: options.name || 'modu-x402',
      version: options.version || '0.1.10',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Expose MCP tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'call_paid_endpoint',
          description:
            'Calls a modu x402-gated endpoint. If payment is required, signs and settles a USDC payment on Algorand via the GoPlausible facilitator, then returns the endpoint\'s response.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The modu proxy URL to call (e.g. https://modu-proxy.onrender.com/p/my-endpoint)',
              },
              confirm: {
                type: 'boolean',
                description:
                  'Set to true to authorize and sign payment after reviewing the price challenge. Required when MODU_MCP_AUTO_PAY is false.',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'wallet_info',
          description:
            'Returns the configured Algorand payout/payer address and its current ALGO and USDC balances (read-only, no signing).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'call_paid_endpoint') {
      const url = args?.url as string;
      if (!url || typeof url !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Parameter "url" is required and must be a string.');
      }

      const autoPay = process.env.MODU_MCP_AUTO_PAY === 'true';
      const isConfirmed = Boolean(args?.confirm);
      let capturedChallenge: X402Challenge | null = null;

      try {
        const result = await callPaidEndpoint(url, {
          mnemonic: process.env.ALGORAND_MNEMONIC,
          confirmBeforePay: async (challenge) => {
            if (autoPay || isConfirmed) {
              return true;
            }
            capturedChallenge = challenge;
            return false; // Abort payment to prompt user/agent for confirmation
          },
        });

        // If endpoint returned 200 without payment
        if (!result.settled) {
          const bodyText =
            typeof result.responseBody === 'object' && result.responseBody !== null
              ? JSON.stringify(result.responseBody, null, 2)
              : String(result.responseBody);

          return {
            content: [
              {
                type: 'text',
                text: bodyText,
              },
            ],
          };
        }

        // Paid & settled successfully
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  settled: true,
                  txid: result.txid,
                  payer: result.payer,
                  amount: result.amount,
                  asset: result.asset,
                  response: result.responseBody,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        // Check if payment was paused for user confirmation
        if (capturedChallenge) {
          const accept = (capturedChallenge as X402Challenge).accepts?.[0];
          const decimals = (accept?.extra?.decimals as number) || 6;
          const assetName =
            (accept?.extra?.name as string) || (accept?.asset === '0' ? 'ALGO' : 'USDC');
          const amountMicro = accept?.amount || accept?.maxAmountRequired || '0';
          let humanAmount = amountMicro;
          try {
            humanAmount = fromBaseUnits(amountMicro, decimals);
          } catch {
            // fallback to raw
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  '⚠️ Payment Confirmation Required',
                  '',
                  'This endpoint is protected by modu x402 micropayments:',
                  `• Resource:    ${url}`,
                  `• Price:       ${humanAmount} ${assetName} (${amountMicro} base units)`,
                  `• Recipient:   ${accept?.payTo || 'Unknown'}`,
                  `• Asset ID:    ${accept?.asset}`,
                  `• Network:     ${accept?.network || 'Algorand'}`,
                  '',
                  'To authorize this payment and retrieve the endpoint response, re-call this tool with:',
                  `call_paid_endpoint({ "url": "${url}", "confirm": true })`,
                ].join('\n'),
              },
            ],
          };
        }

        // Return error to MCP caller
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error calling paid endpoint: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }

    if (name === 'wallet_info') {
      const config = loadConfig();
      const mnemonic = process.env.ALGORAND_MNEMONIC;
      const privateKey = process.env.AVM_PRIVATE_KEY;
      let payerAddress: string | null = null;

      if (mnemonic) {
        try {
          const account = algosdk.mnemonicToSecretKey(mnemonic.trim());
          payerAddress = account.addr.toString();
        } catch (e: any) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error deriving address from ALGORAND_MNEMONIC: ${e.message}`,
              },
            ],
          };
        }
      } else if (privateKey) {
        try {
          const skBytes = Buffer.from(privateKey, 'base64');
          payerAddress = algosdk.encodeAddress(skBytes.subarray(32, 64));
        } catch {
          // ignore
        }
      }

      const payoutAddress = config.payoutAddress;

      if (!payerAddress && !payoutAddress) {
        return {
          content: [
            {
              type: 'text',
              text: [
                'No Algorand wallet or mnemonic is currently configured.',
                '',
                'To configure a payer wallet for MCP payments:',
                '  Set ALGORAND_MNEMONIC in your environment or MCP configuration.',
                '',
                'To configure a developer payout wallet:',
                '  Run `modu config <address>` or `modu wallet create`.',
              ].join('\n'),
            },
          ],
        };
      }

      // Query balance for the target address (payer address preferred for MCP payments)
      const targetAddress = payerAddress || payoutAddress!;
      const targetRole = payerAddress ? 'Payer (signing wallet)' : 'Payout Destination';

      const rawNetwork = process.env.NETWORK || 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
      const isMainnet =
        rawNetwork.includes('wGHE2Pwdvd7S12BL5FaOP20EGYesN73k') ||
        rawNetwork === 'algorand-mainnet' ||
        rawNetwork === 'mainnet';

      const usdcAssetId = isMainnet ? 31566704 : 10458941;
      const defaultAlgod = isMainnet
        ? 'https://mainnet-api.algonode.cloud'
        : 'https://testnet-api.algonode.cloud';
      const algodHost = options.algodHost || defaultAlgod;

      let algoBalance = 'Unknown';
      let usdcBalance = 'Unknown';
      let networkStatus = 'Connected';

      try {
        const algodClient = new algosdk.Algodv2('', algodHost, 443);
        const acct = await algodClient.accountInformation(targetAddress).do();
        const algoMicro = acct.amount ?? 0;
        algoBalance = `${fromBaseUnits(algoMicro, 6)} ALGO`;

        const usdcHolding = (acct.assets || []).find((a: any) => a['asset-id'] === usdcAssetId);
        if (usdcHolding) {
          usdcBalance = `${fromBaseUnits(usdcHolding.amount ?? 0, 6)} USDC`;
        } else {
          usdcBalance = '0 USDC (asset not opted in)';
        }
      } catch (err: any) {
        networkStatus = `Could not fetch live balance from ${algodHost}: ${err.message || String(err)}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                address: targetAddress,
                role: targetRole,
                network: isMainnet ? 'Algorand MainNet' : 'Algorand TestNet',
                balances: {
                  algo: algoBalance,
                  usdc: usdcBalance,
                },
                configuredPayoutAddress: payoutAddress || undefined,
                autoPayEnabled: process.env.MODU_MCP_AUTO_PAY === 'true',
                networkStatus,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Starts the modu x402 MCP server using StdioServerTransport
 */
export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-run if executed directly via node or tsx
if (process.argv[1]?.includes('server.js') || process.argv[1]?.includes('server.ts')) {
  startMcpServer().catch((err) => {
    console.error('Failed to start modu-x402 MCP server:', err);
    process.exit(1);
  });
}
