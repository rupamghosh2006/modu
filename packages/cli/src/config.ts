import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CliConfig, DEFAULT_CONTROL_PLANE_URL, DEFAULT_PROXY_URL } from './shared.js';

export function getDefaultConfigPath(): string {
  if (process.env.MODU_CONFIG_FILE) {
    return process.env.MODU_CONFIG_FILE;
  }
  const baseDir = process.env.MODU_CONFIG_DIR || path.join(os.homedir(), '.modu');
  return path.join(baseDir, 'config.json');
}

export function loadConfig(customPath?: string): CliConfig {
  const filePath = customPath || getDefaultConfigPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<CliConfig>, customPath?: string): CliConfig {
  const filePath = customPath || getDefaultConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const current = loadConfig(filePath);
  const next: CliConfig = { ...current, ...updates };

  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod can fail on certain filesystems/Windows, ignore if so
  }

  return next;
}

export function getControlPlaneUrl(config?: CliConfig): string {
  return (
    process.env.MODU_CONTROL_PLANE_URL ||
    config?.controlPlaneUrl ||
    DEFAULT_CONTROL_PLANE_URL
  ).replace(/\/$/, '');
}

export function getProxyUrl(config?: CliConfig): string {
  return (
    process.env.MODU_PROXY_URL ||
    config?.proxyUrl ||
    DEFAULT_PROXY_URL
  ).replace(/\/$/, '');
}
