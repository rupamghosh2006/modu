import { Command } from 'commander';
import { configCommand } from './commands/config.js';
import { loginCommand } from './commands/login.js';
import { walletCreateCommand, walletConnectCommand } from './commands/wallet.js';
import { registerCommand } from './commands/register.js';
import { listCommand } from './commands/list.js';
import { revokeCommand } from './commands/revoke.js';
import { logsCommand } from './commands/logs.js';
import { statsCommand } from './commands/stats.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('modu')
    .description('Turn any existing HTTP API endpoint into a pay-per-request endpoint with x402 on Algorand')
    .version('0.1.0')
    .option('--json', 'Output results as JSON for scriptability');

  // modu config [address]
  program
    .command('config [address]')
    .description('Configure authentication and Algorand payout wallet destination')
    .option('--address <address>', 'Algorand payout destination address')
    .option('--relogin', 'Force re-authentication in browser')
    .option('--json', 'Output result in JSON format')
    .action(async (address?: string, opts?: any, cmd?: any) => {
      const commandObj = cmd || opts;
      const isJson = opts?.json || commandObj?.optsWithGlobals?.()?.json;
      await configCommand(address, {
        address: opts?.address,
        relogin: opts?.relogin,
        json: isJson,
      });
    });

  // modu login (legacy shortcut - now also part of `modu config`)
  program
    .command('login')
    .description('Authenticate CLI with your modu developer account via browser')
    .option('--json', 'Output result in JSON format')
    .action(async (opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await loginCommand({ json: isJson });
    });

  // modu wallet
  const wallet = program.command('wallet').description('Manage Algorand payout wallet');

  wallet
    .command('create')
    .description('Generate a fresh Algorand keypair locally (mnemonic displayed only once)')
    .option('--json', 'Output generated wallet in JSON format')
    .action(async (opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await walletCreateCommand({ json: isJson });
    });

  wallet
    .command('connect <address>')
    .description('Set your Algorand address as the payout destination for all monetized endpoints')
    .option('--json', 'Output result in JSON format')
    .action(async (address: string, opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await walletConnectCommand(address, { json: isJson });
    });

  // modu register [--url <url>] [--price <amount>] [--asset <USDC|ALGO>] [--path <slug>]
  program
    .command('register')
    .alias('rergister')
    .description('Register and monetize an HTTP origin endpoint with x402 micropayments (prompts interactively if flags omitted)')
    .option('--url <origin-url>', 'The origin URL to proxy (e.g. https://my-api.com/v1/generate)')
    .option('--price <amount>', 'Price per request in tokens (e.g. 0.001)')
    .option('--asset <USDC|ALGO>', 'Payment asset (USDC or ALGO)')
    .option('--path <slug>', 'Custom proxy path slug (e.g. "my-endpoint")')
    .option('--json', 'Output result in JSON format')
    .action(async (opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await registerCommand({
        url: opts.url,
        price: opts.price,
        asset: opts.asset,
        path: opts.path,
        json: isJson,
      });
    });

  // modu list
  program
    .command('list')
    .description('List all registered endpoints with today\'s request volume and revenue')
    .option('--json', 'Output list in JSON format')
    .action(async (opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await listCommand({ json: isJson });
    });

  // modu revoke <endpointId>
  program
    .command('revoke <endpointId>')
    .description('Revoke an endpoint (immediately returns 410 Gone at the edge proxy)')
    .option('--json', 'Output result in JSON format')
    .action(async (endpointId: string, opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await revokeCommand(endpointId, { json: isJson });
    });

  // modu logs <endpointId> [--follow]
  program
    .command('logs <endpointId>')
    .description('View recent requests or stream live requests for an endpoint')
    .option('-f, --follow', 'Stream live requests in real-time via SSE')
    .option('-n, --limit <n>', 'Number of recent requests to display', '50')
    .option('--json', 'Output logs in JSON format')
    .action(async (endpointId: string, opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await logsCommand(endpointId, {
        follow: opts.follow,
        limit: opts.limit,
        json: isJson,
      });
    });

  // modu stats <endpointId>
  program
    .command('stats <endpointId>')
    .description('Display revenue summary, daily volume, and top payer addresses for an endpoint')
    .option('--json', 'Output stats in JSON format')
    .action(async (endpointId: string, opts, cmd) => {
      const isJson = opts.json || cmd.optsWithGlobals().json;
      await statsCommand(endpointId, { json: isJson });
    });

  return program;
}

export async function run(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
