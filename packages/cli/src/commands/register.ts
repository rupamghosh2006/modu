import chalk from 'chalk';
import { loadConfig, getControlPlaneUrl } from '../config.js';

export interface RegisterOptions {
  url: string;
  price: string;
  asset: string;
  path?: string;
  json?: boolean;
  configPath?: string;
  skipReachabilityCheck?: boolean;
}

export async function registerCommand(options: RegisterOptions): Promise<void> {
  const config = loadConfig(options.configPath);
  if (!config.apiKey) {
    const errorMsg = 'Not authenticated. Please run `modu login` first.';
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  // Basic validation
  if (!options.url || !options.price || !options.asset) {
    const errorMsg = 'Missing required flags: --url, --price, and --asset are required.';
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  const assetUpper = options.asset.toUpperCase();
  if (assetUpper !== 'USDC' && assetUpper !== 'ALGO') {
    const errorMsg = `Invalid asset "${options.asset}". Allowed assets are USDC or ALGO.`;
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  // 1. Reachability check: 3s HEAD request (warns, does not block)
  if (!options.skipReachabilityCheck) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      await fetch(options.url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      if (!options.json) {
        console.warn(
          chalk.yellow(
            `⚠️  Warning: Origin URL "${options.url}" is not reachable (or timed out after 3s). Registering anyway.`
          )
        );
      }
    }
  }

  // 2. Register endpoint on control plane
  const controlPlaneUrl = getControlPlaneUrl(config);

  try {
    const res = await fetch(`${controlPlaneUrl}/api/endpoints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        originUrl: options.url,
        price: options.price,
        asset: assetUpper,
        path: options.path,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    const data = (await res.json()) as {
      endpointId: string;
      slug: string;
      proxyUrl: string;
      originUrl: string;
      price: string;
      asset: string;
      payoutAddress: string;
    };

    if (options.json) {
      console.log(JSON.stringify(data));
      return;
    }

    console.log(chalk.bold.green('\n⚡ Endpoint Registered Successfully!\n'));
    console.log(`${chalk.bold('Endpoint ID:')}    ${chalk.cyan(data.endpointId)}`);
    console.log(`${chalk.bold('Proxy URL:')}      ${chalk.bold.underline.blue(data.proxyUrl)}`);
    console.log(`${chalk.bold('Origin URL:')}     ${chalk.dim(data.originUrl)}`);
    console.log(`${chalk.bold('Price:')}          ${chalk.yellow(`${data.price} ${data.asset}`)}`);
    console.log(`${chalk.bold('Payout To:')}       ${chalk.green(data.payoutAddress)}`);

    console.log(chalk.bold('\nTry it with curl:'));
    console.log(chalk.dim('# 1. Call endpoint without payment — receive HTTP 402 challenge:'));
    console.log(`  ${chalk.cyan(`curl -i ${data.proxyUrl}`)}`);
    console.log(chalk.dim('\n# 2. Call endpoint with confirmed Algorand payment txid:'));
    console.log(
      `  ${chalk.cyan(`curl -i -H "X-PAYMENT-TXID: <txid>" ${data.proxyUrl}`)}\n`
    );
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
