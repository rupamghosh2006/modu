import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export function getDefaultLogPath(): string {
  if (process.env.MODU_LOG_FILE) {
    return process.env.MODU_LOG_FILE;
  }
  const baseDir = process.env.MODU_CONFIG_DIR || path.join(os.homedir(), '.modu');
  return path.join(baseDir, 'modu.log');
}

export function writeLog(
  level: LogLevel,
  category: string,
  message: string,
  details?: unknown,
  customPath?: string
): void {
  try {
    const filePath = customPath || getDefaultLogPath();
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${level}] [${category}] ${message}`;

    if (details !== undefined) {
      if (details instanceof Error) {
        line += ` | Error: ${details.message}\nStack: ${details.stack}`;
      } else if (typeof details === 'object') {
        try {
          line += ` | ${JSON.stringify(details)}`;
        } catch {
          line += ` | [Non-serializable object]`;
        }
      } else {
        line += ` | ${String(details)}`;
      }
    }

    fs.appendFileSync(filePath, line + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Silently ignore logging failures to prevent disrupting CLI user flows
  }
}

export function logInfo(category: string, message: string, details?: unknown, customPath?: string): void {
  writeLog('INFO', category, message, details, customPath);
}

export function logWarn(category: string, message: string, details?: unknown, customPath?: string): void {
  writeLog('WARN', category, message, details, customPath);
}

export function logError(category: string, message: string, details?: unknown, customPath?: string): void {
  writeLog('ERROR', category, message, details, customPath);
}

export function logDebug(category: string, message: string, details?: unknown, customPath?: string): void {
  writeLog('DEBUG', category, message, details, customPath);
}
