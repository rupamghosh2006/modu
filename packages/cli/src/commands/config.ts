import algosdk from 'algosdk';
import chalk from 'chalk';
import open from 'open';
import { loadConfig, saveConfig, getControlPlaneUrl, getProxyUrl } from '../config.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { promptText } from '../prompts.js';

export interface ConfigOptions {
  address?: string;
  json?: boolean;
  configPath?: string;
  autoOpen?: boolean;
  relogin?: boolean;
  pollIntervalMs?: number;
  maxPollSeconds?: number;
}

export async function configCommand(
  addressArg?: string,
  options: ConfigOptions = {}
): Promise<void> {
  const config = loadConfig(options.configPath);
  const controlPlaneUrl = getControlPlaneUrl(config);
  const proxyUrl = getProxyUrl(config);

  logInfo('CONFIG', 'Starting modu config command', {
    hasApiKey: !!config.apiKey,
    hasPayoutAddress: !!config.payoutAddress,
    addressArg,
    options,
  });

  // 1. Authentication check or login
  let apiKey = config.apiKey;
  let payoutAddress = config.payoutAddress;

  if (!apiKey || options.relogin) {
    if (!options.json) {
      console.log(chalk.bold.cyan('\n⚡ modu CLI Setup & Configuration'));
      console.log(chalk.dim('Step 1 of 2: Developer Authentication'));
    }

    logInfo('AUTH', 'Requesting CLI token from control plane', { controlPlaneUrl });

    let tokenRes: { token: string; authUrl: string; pollUrl: string };
    try {
      const res = await fetch(`${controlPlaneUrl}/api/auth/cli-token`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`Failed to request CLI token: ${res.status} ${res.statusText}`);
      }
      tokenRes = (await res.json()) as any;
    } catch (err: any) {
      logError('AUTH', 'Failed to request CLI token', err);
      if (options.json) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.error(chalk.red(`Error: ${err.message}`));
      }
      process.exitCode = 1;
      return;
    }

    if (!options.json) {
      console.log(`Opening browser to authorize CLI: ${chalk.underline(tokenRes.authUrl)}`);
    }

    if (options.autoOpen !== false) {
      try {
        await open(tokenRes.authUrl);
      } catch {
        if (!options.json) {
          console.log(
            chalk.yellow(`Could not open browser automatically. Please visit:\n${tokenRes.authUrl}`)
          );
        }
      }
    }

    if (!options.json) {
      process.stdout.write('Waiting for authorization in browser... ');
    }

    const pollInterval = options.pollIntervalMs || 2000;
    const maxPollSec = options.maxPollSeconds || 300;
    const startTime = Date.now();
    let loginSucceeded = false;

    while (Date.now() - startTime < maxPollSec * 1000) {
      await new Promise((r) => setTimeout(r, pollInterval));

      try {
        const pollRes = await fetch(tokenRes.pollUrl);
        if (!pollRes.ok) continue;

        const pollData = (await pollRes.json()) as {
          status: 'pending' | 'claimed' | 'expired';
          apiKey?: string;
          payoutAddress?: string;
        };

        if (pollData.status === 'claimed' && pollData.apiKey) {
          apiKey = pollData.apiKey;
          if (pollData.payoutAddress) {
            payoutAddress = pollData.payoutAddress;
          }
          saveConfig(
            {
              apiKey,
              payoutAddress,
            },
            options.configPath
          );
          loginSucceeded = true;
          logInfo('AUTH', 'Authentication successful, credentials saved', {
            apiKeyPrefix: apiKey.slice(0, 12),
            payoutAddress,
          });

          if (!options.json) {
            console.log(chalk.green('\n✓ Successfully authenticated!'));
          }
          break;
        }

        if (pollData.status === 'expired') {
          throw new Error('CLI login token expired. Please run `modu config` again.');
        }
      } catch (err: any) {
        if (err.message.includes('expired')) {
          logError('AUTH', 'CLI token expired', err);
          if (options.json) {
            console.log(JSON.stringify({ error: err.message }));
          } else {
            console.log(chalk.red(`\n${err.message}`));
          }
          process.exitCode = 1;
          return;
        }
      }
    }

    if (!loginSucceeded) {
      const timeoutMsg = 'Authentication timed out. Please try again.';
      logError('AUTH', timeoutMsg);
      if (options.json) {
        console.log(JSON.stringify({ error: timeoutMsg }));
      } else {
        console.log(chalk.red(`\n${timeoutMsg}`));
      }
      process.exitCode = 1;
      return;
    }
  } else {
    if (!options.json) {
      console.log(chalk.bold.cyan('\n⚡ modu CLI Configuration'));
      console.log(chalk.green('✓ Authenticated with modu control plane.'));
    }
  }

  // 2. Connect Algorand payout wallet
  if (!options.json) {
    console.log(chalk.dim('\nStep 2 of 2: Connect Algorand Payout Wallet'));
  }

  let chosenAddress = addressArg || options.address;

  if (!chosenAddress) {
    if (options.json) {
      // Non-interactive / JSON mode without explicit address: check if already set
      if (payoutAddress) {
        console.log(
          JSON.stringify({
            status: 'configured',
            apiKey,
            payoutAddress,
            proxyUrl,
            controlPlaneUrl,
          })
        );
        return;
      } else {
        const errorMsg = 'Payout address required. Provide an address: `modu config <address>`';
        logError('CONFIG', errorMsg);
        console.log(JSON.stringify({ error: errorMsg }));
        process.exitCode = 1;
        return;
      }
    }

    // Interactive prompt
    while (true) {
      const defaultDisplay = payoutAddress ? payoutAddress : undefined;
      const inputAddr = await promptText(
        'Enter your Algorand payout wallet address',
        defaultDisplay
      );

      const target = inputAddr.trim() || defaultDisplay;
      if (!target) {
        console.log(chalk.yellow('An Algorand address is required for receiving endpoint micropayments.'));
        continue;
      }

      if (!algosdk.isValidAddress(target)) {
        console.log(chalk.red(`✖ Invalid Algorand address checksum: "${target}". Please check and re-enter.`));
        continue;
      }

      chosenAddress = target;
      break;
    }
  } else {
    // Validate provided address
    const clean = chosenAddress.trim();
    if (!algosdk.isValidAddress(clean)) {
      const errorMsg = `Invalid Algorand address checksum: "${chosenAddress}"`;
      logError('CONFIG', errorMsg);
      if (options.json) {
        console.log(JSON.stringify({ error: errorMsg }));
      } else {
        console.error(chalk.red(`Error: ${errorMsg}`));
      }
      process.exitCode = 1;
      return;
    }
    chosenAddress = clean;
  }

  // 3. Register payout address on control plane
  try {
    logInfo('CONFIG', 'Connecting payout address to control plane', {
      payoutAddress: chosenAddress,
      controlPlaneUrl,
    });

    const res = await fetch(`${controlPlaneUrl}/api/account/payout-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ payoutAddress: chosenAddress }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    // Save to local config
    saveConfig({ payoutAddress: chosenAddress }, options.configPath);
    logInfo('CONFIG', 'Payout address configured and saved successfully', {
      payoutAddress: chosenAddress,
    });

    if (options.json) {
      console.log(
        JSON.stringify({
          status: 'configured',
          apiKey,
          payoutAddress: chosenAddress,
          proxyUrl,
          controlPlaneUrl,
        })
      );
      return;
    }

    console.log(chalk.bold.green('\n✓ Configuration Complete!'));
    console.log(`${chalk.bold('Account:')}         ${chalk.green('Authenticated')}`);
    console.log(`${chalk.bold('Payout Wallet:')}   ${chalk.cyan(chosenAddress)}`);
    console.log(`${chalk.bold('Proxy URL:')}       ${chalk.bold.underline.blue(proxyUrl)}`);
    console.log(
      `${chalk.dim('All x402 endpoint payments will settle directly to your payout wallet.')}\n`
    );
    console.log(`Ready to monetize! Register your first endpoint with:`);
    console.log(`  ${chalk.cyan('npx modu register')}\n`);
  } catch (err: any) {
    logError('CONFIG', 'Failed to register payout address', err);
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
