import chalk from 'chalk';
import open from 'open';
import { loadConfig, saveConfig, getControlPlaneUrl } from '../config.js';
import { logInfo, logWarn, logError } from '../logger.js';

export interface LoginOptions {
  json?: boolean;
  configPath?: string;
  autoOpen?: boolean;
  pollIntervalMs?: number;
  maxPollSeconds?: number;
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const config = loadConfig(options.configPath);
  const controlPlaneUrl = getControlPlaneUrl(config);

  logInfo('LOGIN', 'Starting login command', { controlPlaneUrl });

  // 1. Request CLI token from control plane
  let tokenRes: { token: string; authUrl: string; pollUrl: string };
  try {
    const res = await fetch(`${controlPlaneUrl}/api/auth/cli-token`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error(`Failed to request CLI token: ${res.status} ${res.statusText}`);
    }
    tokenRes = (await res.json()) as any;
    logInfo('LOGIN', 'CLI token issued', { pollUrl: tokenRes.pollUrl });
  } catch (err: any) {
    logError('LOGIN', 'Failed to request CLI token', err);
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
    return;
  }

  if (!options.json) {
    console.log(chalk.bold.cyan('⚡ modu CLI Authentication'));
    console.log(`Opening browser to authorize CLI: ${chalk.underline(tokenRes.authUrl)}`);
  }

  // 2. Open browser unless disabled (e.g. in headless tests)
  if (options.autoOpen !== false) {
    try {
      await open(tokenRes.authUrl);
    } catch {
      if (!options.json) {
        console.log(chalk.yellow(`Could not open browser automatically. Please visit:\n${tokenRes.authUrl}`));
      }
    }
  }

  if (!options.json) {
    process.stdout.write('Waiting for authorization in browser... ');
  }

  // 3. Poll control plane until claimed or expired
  const pollInterval = options.pollIntervalMs || 2000;
  const maxPollSec = options.maxPollSeconds || 300;
  const startTime = Date.now();

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
        saveConfig(
          {
            apiKey: pollData.apiKey,
            payoutAddress: pollData.payoutAddress || config.payoutAddress,
          },
          options.configPath
        );
        logInfo('LOGIN', 'CLI session claimed and API key saved');

        if (options.json) {
          console.log(
            JSON.stringify({
              status: 'claimed',
              apiKey: pollData.apiKey,
              payoutAddress: pollData.payoutAddress,
            })
          );
        } else {
          console.log(chalk.green('\n✓ Successfully authenticated!'));
          console.log(`API key saved to ${chalk.dim(options.configPath || '~/.modu/config.json')}`);
          if (pollData.payoutAddress) {
            console.log(`Payout address: ${chalk.cyan(pollData.payoutAddress)}`);
          } else {
            console.log(chalk.yellow('Next step: configure your payout address with `modu config`'));
          }
        }
        return;
      }

      if (pollData.status === 'expired') {
        throw new Error('CLI login token expired. Please run `modu config` again.');
      }
    } catch (err: any) {
      if (err.message.includes('expired')) {
        logError('LOGIN', 'CLI token expired', err);
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

  const timeoutMsg = 'Authentication timed out. Please try again.';
  logError('LOGIN', timeoutMsg);
  if (options.json) {
    console.log(JSON.stringify({ error: timeoutMsg }));
  } else {
    console.log(chalk.red(`\n${timeoutMsg}`));
  }
  process.exitCode = 1;
}
