import algosdk from 'algosdk';
import chalk from 'chalk';
import { loadConfig, saveConfig, getControlPlaneUrl } from '../config.js';
import { logInfo, logError } from '../logger.js';

export interface WalletCreateOptions {
  json?: boolean;
}

export interface WalletConnectOptions {
  json?: boolean;
  configPath?: string;
}

export async function walletCreateCommand(options: WalletCreateOptions = {}): Promise<void> {
  // Generate keypair locally using official algosdk
  const account = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const address = account.addr;

  logInfo('WALLET', 'Generated new Algorand wallet', { address });

  if (options.json) {
    console.log(
      JSON.stringify({
        address,
        mnemonic,
        warning: 'Store this mnemonic securely offline. modu never transmits or stores private keys.',
      })
    );
    return;
  }

  console.log(chalk.bold.cyan('\n🔑 Fresh Algorand Keypair Generated'));
  console.log(`${chalk.bold('Public Address:')}  ${chalk.green(address)}`);
  console.log(`${chalk.bold('Mnemonic:')}        ${chalk.yellow(mnemonic)}`);
  console.log(
    chalk.bgRed.white.bold('\n ⚠️  WARNING: BACK UP YOUR 25-WORD MNEMONIC! ') +
      chalk.red(
        '\nThis is displayed ONCE and cannot be recovered. modu never transmits or stores your private key or mnemonic.\n'
      )
  );
  console.log(`To set this wallet as your endpoint payout destination, run:`);
  console.log(`  ${chalk.cyan(`modu config ${address}`)}\n`);
}

export async function walletConnectCommand(
  address: string,
  options: WalletConnectOptions = {}
): Promise<void> {
  const cleanAddress = address ? address.trim() : '';

  logInfo('WALLET', 'Attempting to connect payout address', { address: cleanAddress });

  // Validate address checksum locally using algosdk
  if (!cleanAddress || !algosdk.isValidAddress(cleanAddress)) {
    const errorMsg = `Invalid Algorand address checksum: "${address}"`;
    logError('WALLET', errorMsg);
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(options.configPath);
  if (!config.apiKey) {
    const errorMsg = 'Not authenticated. Please run `modu config` first.';
    logError('WALLET', errorMsg);
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  const controlPlaneUrl = getControlPlaneUrl(config);

  try {
    const res = await fetch(`${controlPlaneUrl}/api/account/payout-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ payoutAddress: cleanAddress }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    // Save payout address in local config
    saveConfig({ payoutAddress: cleanAddress }, options.configPath);
    logInfo('WALLET', 'Payout address connected successfully', { address: cleanAddress });

    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          payoutAddress: cleanAddress,
        })
      );
    } else {
      console.log(chalk.green('✓ Payout address connected successfully!'));
      console.log(`All x402 endpoint payments will settle directly to: ${chalk.cyan(cleanAddress)}`);
    }
  } catch (err: any) {
    logError('WALLET', 'Failed to connect payout address', err);
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
