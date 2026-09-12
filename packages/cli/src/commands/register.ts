import chalk from 'chalk';
import { loadConfig, getControlPlaneUrl, getProxyUrl } from '../config.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { promptText, promptSelect } from '../prompts.js';

export interface RegisterOptions {
  url?: string;
  price?: string;
  asset?: string;
  path?: string;
  json?: boolean;
  configPath?: string;
  skipReachabilityCheck?: boolean;
}

export async function registerCommand(options: RegisterOptions = {}): Promise<void> {
  const config = loadConfig(options.configPath);
  if (!config.apiKey) {
    const errorMsg = 'Not authenticated. Please run `modu config` first.';
    logWarn('REGISTER', 'Authentication required', { configPath: options.configPath });
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  let url = options.url?.trim();
  let price = options.price?.trim();
  let asset = options.asset?.trim();
  let pathSlug = options.path?.trim();

  // If any required field is missing: prompt interactively (or return error in JSON mode)
  if (!url || !price || !asset) {
    if (options.json) {
      const errorMsg = 'Missing required flags: --url, --price, and --asset are required in JSON mode.';
      logError('REGISTER', errorMsg);
      console.log(JSON.stringify({ error: errorMsg }));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.bold.cyan('\n⚡ Monetize an Endpoint with x402 Micropayments'));
    console.log(chalk.dim('Follow the prompts below to configure your pay-per-request endpoint:\n'));

    // 1. Prompt for URL
    if (!url) {
      while (true) {
        url = (await promptText('Origin URL to proxy (e.g. https://httpbin.org/get)')).trim();
        if (!url) {
          console.log(chalk.red('Origin URL is required.'));
          continue;
        }
        if (!/^https?:\/\//i.test(url)) {
          console.log(chalk.red('Origin URL must start with http:// or https://.'));
          continue;
        }
        break;
      }
    }

    // 2. Prompt for Price
    if (!price) {
      while (true) {
        price = (await promptText('Price per request in tokens (e.g. 0.001)')).trim();
        if (!price) {
          console.log(chalk.red('Price is required.'));
          continue;
        }
        const numPrice = Number(price);
        if (isNaN(numPrice) || numPrice <= 0) {
          console.log(chalk.red('Price must be a valid positive number (e.g. 0.001).'));
          continue;
        }
        break;
      }
    }

    // 3. Prompt for Asset with option select
    if (!asset) {
      asset = await promptSelect(
        'Select payment asset:',
        [
          { label: 'USDC', value: 'USDC', description: 'USD Coin on Algorand (ASA 10458941)' },
          { label: 'ALGO', value: 'ALGO', description: 'Native Algorand cryptocurrency' },
        ],
        0 // Default to USDC
      );
    }

    // 4. Prompt for custom path (optional)
    if (pathSlug === undefined) {
      const enteredPath = (
        await promptText('Custom proxy path slug (optional, press Enter to auto-generate)')
      ).trim();
      pathSlug = enteredPath || undefined;
    }
  }

  const assetUpper = asset.toUpperCase();
  if (assetUpper !== 'USDC' && assetUpper !== 'ALGO') {
    const errorMsg = `Invalid asset "${asset}". Allowed assets are USDC or ALGO.`;
    logError('REGISTER', errorMsg);
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg }));
    } else {
      console.error(chalk.red(`Error: ${errorMsg}`));
    }
    process.exitCode = 1;
    return;
  }

  logInfo('REGISTER', 'Initiating endpoint registration', {
    url,
    price,
    asset: assetUpper,
    path: pathSlug,
  });

  // 1. Reachability check: 3s HEAD request (warns, does not block)
  if (!options.skipReachabilityCheck) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      logInfo('REGISTER', `Origin URL ${url} is reachable`);
    } catch (err: any) {
      logWarn('REGISTER', `Origin URL ${url} is not reachable or timed out`, err.message);
      if (!options.json) {
        console.warn(
          chalk.yellow(
            `⚠️  Warning: Origin URL "${url}" is not reachable (or timed out after 3s). Registering anyway.`
          )
        );
      }
    }
  }

  // 2. Register endpoint on control plane
  const controlPlaneUrl = getControlPlaneUrl(config);
  const proxyBaseUrl = getProxyUrl(config);

  try {
    const res = await fetch(`${controlPlaneUrl}/api/endpoints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        originUrl: url,
        price,
        asset: assetUpper,
        path: pathSlug,
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

    // Ensure proxy URL points to the correct configured proxy URL instead of localhost:4000
    if (data.proxyUrl?.includes('localhost:4000') || !data.proxyUrl) {
      data.proxyUrl = `${proxyBaseUrl}/p/${data.slug}`;
    }

    logInfo('REGISTER', 'Endpoint registered successfully', {
      endpointId: data.endpointId,
      slug: data.slug,
      proxyUrl: data.proxyUrl,
      originUrl: data.originUrl,
      price: data.price,
      asset: data.asset,
    });

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
    logError('REGISTER', 'Registration error', err);
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
