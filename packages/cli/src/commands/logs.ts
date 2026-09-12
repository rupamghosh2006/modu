import chalk from 'chalk';
import Table from 'cli-table3';
import { loadConfig, saveConfig, getControlPlaneUrl } from '../config.js';
import { RequestLog } from '../shared.js';

export interface LogsOptions {
  follow?: boolean;
  limit?: string;
  json?: boolean;
  configPath?: string;
}

export async function logsCommand(endpointId: string, options: LogsOptions = {}): Promise<void> {
  const cleanId = endpointId ? endpointId.trim() : '';
  if (!cleanId) {
    const errorMsg = 'Endpoint ID is required. Usage: modu logs <endpointId>';
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

  if (options.follow) {
    if (!options.json) {
      console.log(chalk.bold.cyan(`Streaming live requests for endpoint ${cleanId}... (Ctrl+C to stop)\n`));
    }

    try {
      const res = await fetch(`${controlPlaneUrl}/api/endpoints/${encodeURIComponent(cleanId)}/logs?follow=true`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'text/event-stream',
        },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          saveConfig({ apiKey: undefined }, options.configPath);
          throw new Error('Invalid or expired API key. Credentials cleared; please run `modu config` to re-authenticate in browser.');
        }
        throw new Error(`Failed to stream logs: ${res.status} ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error('Response body is null');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawJson = line.slice(6).trim();
            if (!rawJson) continue;
            try {
              const log = JSON.parse(rawJson) as RequestLog;
              if (options.json) {
                console.log(JSON.stringify(log));
              } else {
                const statusColor = log.status === 200 ? chalk.green : chalk.red;
                const time = new Date(log.timestamp).toLocaleTimeString();
                console.log(
                  `${chalk.dim(`[${time}]`)} ${statusColor(`${log.status}`)} ${chalk.yellow(
                    `${log.latencyMs}ms`
                  )} Payer: ${chalk.cyan(log.payerAddress.slice(0, 8))}... Tx: ${chalk.dim(
                    log.txid.slice(0, 10)
                  )}... Amount: ${log.amount}`
                );
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (err: any) {
      if (options.json) {
        console.log(JSON.stringify({ error: err.message }));
      } else {
        console.error(chalk.red(`\nStream closed: ${err.message}`));
      }
    }
    return;
  }

  // Non-follow (snapshot)
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 50;
    const res = await fetch(
      `${controlPlaneUrl}/api/endpoints/${encodeURIComponent(cleanId)}/logs?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      }
    );

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      if (res.status === 401 || res.status === 403) {
        saveConfig({ apiKey: undefined }, options.configPath);
        throw new Error('Invalid or expired API key. Credentials cleared; please run `modu config` to re-authenticate in browser.');
      }
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    const logs = (await res.json()) as RequestLog[];

    if (options.json) {
      console.log(JSON.stringify(logs));
      return;
    }

    if (logs.length === 0) {
      console.log(chalk.yellow(`No requests logged yet for endpoint ${cleanId}.`));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Timestamp'),
        chalk.cyan('Status'),
        chalk.cyan('Latency'),
        chalk.cyan('Payer Address'),
        chalk.cyan('TxID'),
        chalk.cyan('Amount (micro)'),
      ],
      style: { head: [], border: [] },
    });

    for (const log of logs) {
      table.push([
        new Date(log.timestamp).toLocaleString(),
        log.status === 200 ? chalk.green(log.status) : chalk.red(log.status),
        `${log.latencyMs}ms`,
        `${log.payerAddress.slice(0, 10)}...`,
        `${log.txid.slice(0, 12)}...`,
        log.amount,
      ]);
    }

    console.log(chalk.bold.cyan(`\nRecent Request Logs (${cleanId}):`));
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
