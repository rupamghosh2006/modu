import chalk from 'chalk';
import Table from 'cli-table3';
import { loadConfig, saveConfig, getControlPlaneUrl } from '../config.js';
import { EndpointStats } from '../shared.js';

export interface StatsOptions {
  json?: boolean;
  configPath?: string;
}

export async function statsCommand(endpointId: string, options: StatsOptions = {}): Promise<void> {
  const cleanId = endpointId ? endpointId.trim() : '';
  if (!cleanId) {
    const errorMsg = 'Endpoint ID is required. Usage: modu stats <endpointId>';
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
    const res = await fetch(`${controlPlaneUrl}/api/endpoints/${encodeURIComponent(cleanId)}/stats`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      if (res.status === 401 || res.status === 403) {
        saveConfig({ apiKey: undefined }, options.configPath);
        throw new Error('Invalid or expired API key. Credentials cleared; please run `modu config` to re-authenticate in browser.');
      }
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    const stats = (await res.json()) as EndpointStats;

    if (options.json) {
      console.log(JSON.stringify(stats));
      return;
    }

    console.log(chalk.bold.cyan(`\n📊 Revenue Summary: Endpoint ${cleanId}`));
    console.log('-------------------------------------------');
    console.log(`${chalk.bold('Total Requests:')}   ${stats.totalRequests}`);
    console.log(`${chalk.bold('Paid Requests:')}    ${chalk.green(stats.paidRequests)}`);
    console.log(`${chalk.bold('Total Revenue:')}    ${chalk.bold.yellow(stats.totalRevenue)}`);
    console.log(`${chalk.bold('Revenue Today:')}    ${chalk.yellow(stats.revenueToday)}`);
    console.log(`${chalk.bold('Requests Today:')}   ${stats.requestsToday}`);

    // Daily breakdown table
    if (stats.revenueByDay && stats.revenueByDay.length > 0) {
      console.log(chalk.bold('\nRevenue by Day:'));
      const dayTable = new Table({
        head: [chalk.cyan('Date'), chalk.cyan('Requests'), chalk.cyan('Revenue')],
        style: { head: [], border: [] },
      });
      for (const d of stats.revenueByDay) {
        dayTable.push([d.date, d.requests.toString(), d.amount]);
      }
      console.log(dayTable.toString());
    }

    // Top payers table
    if (stats.topPayers && stats.topPayers.length > 0) {
      console.log(chalk.bold('\nTop Payer Addresses:'));
      const payerTable = new Table({
        head: [chalk.cyan('Payer Address'), chalk.cyan('Requests'), chalk.cyan('Total Paid')],
        style: { head: [], border: [] },
      });
      for (const p of stats.topPayers) {
        payerTable.push([p.address, p.requests.toString(), p.totalAmount]);
      }
      console.log(payerTable.toString());
    }

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
