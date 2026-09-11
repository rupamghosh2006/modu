import chalk from 'chalk';
import { loadConfig, getControlPlaneUrl } from '../config.js';

export interface RevokeOptions {
  json?: boolean;
  configPath?: string;
}

export async function revokeCommand(endpointId: string, options: RevokeOptions = {}): Promise<void> {
  const cleanId = endpointId ? endpointId.trim() : '';
  if (!cleanId) {
    const errorMsg = 'Endpoint ID is required. Usage: modu revoke <endpointId>';
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
    const res = await fetch(`${controlPlaneUrl}/api/endpoints/${encodeURIComponent(cleanId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      throw new Error(errBody.error || `Control plane returned ${res.status}`);
    }

    const data = (await res.json()) as { success: boolean; endpointId: string; status: string };

    if (options.json) {
      console.log(JSON.stringify(data));
      return;
    }

    console.log(chalk.green(`✓ Endpoint ${chalk.bold(cleanId)} successfully revoked.`));
    console.log(chalk.dim('The edge proxy will now return HTTP 410 Gone for all requests to this route immediately.'));
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}
