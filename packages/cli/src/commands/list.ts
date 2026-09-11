import chalk from 'chalk';
import Table from 'cli-table3';
import { loadConfig, getControlPlaneUrl } from '../config.js';
import { EndpointSummary } from '@modu/shared';

export interface ListOptions {
  json?: boolean;
  configPath?: string;
}

export async function listCommand(options: ListOptions = {}): Promise<void> {
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

  const controlPlaneUrl = getControlPlaneUrl(config);

  try {
    const res = await fetch(`${controlPlaneUrl}/api/endpoints`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    const endpoints = (await res.json()) as EndpointSummary[];

    if (options.json) {
      console.log(JSON.stringify(endpoints));
      return;
    }

    if (endpoints.length === 0) {
      console.log(chalk.yellow('No endpoints registered yet.'));
      console.log(`Register one with: ${chalk.cyan('modu register --url <url> --price <amount> --asset USDC')}`);
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Proxy URL'),
        chalk.cyan('Origin URL'),
        chalk.cyan('Price'),
        chalk.cyan('Reqs Today'),
        chalk.cyan('Rev Today'),
        chalk.cyan('Status'),
      ],
      style: { head: [], border: [] },
    });

    for (const ep of endpoints) {
      table.push([
        ep.id,
        chalk.bold(ep.proxyUrl),
        ep.originUrl.length > 35 ? `${ep.originUrl.slice(0, 32)}...` : ep.originUrl,
        `${ep.price} ${ep.asset}`,
        ep.requestsToday.toString(),
        `${ep.revenueToday} ${ep.asset}`,
        ep.isActive ? chalk.green('Active') : chalk.red('Revoked'),
      ]);
    }

    console.log(chalk.bold.cyan('\nRegistered Endpoints:'));
    console.log(table.toString());
    console.log('');
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
