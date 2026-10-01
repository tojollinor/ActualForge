import { existsSync } from 'node:fs';
import path from 'node:path';

export interface FinanceEngineConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  actualBaseUrl: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid FINANCE_ENGINE_PORT: ${value}`);
  }

  return port;
}

function parseHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ACTUALFORGE_ACTUAL_URL must use http or https');
  }

  return url.toString().replace(/\/$/, '');
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): FinanceEngineConfig {
  const dataDir =
    env.FINANCE_ENGINE_DATA_DIR ??
    (existsSync('/data') ? '/data' : path.resolve(cwd, 'data', 'finance-engine'));

  return {
    host: env.FINANCE_ENGINE_HOST ?? '0.0.0.0',
    port: parsePort(env.FINANCE_ENGINE_PORT, 5010),
    dataDir,
    databasePath:
      env.FINANCE_ENGINE_DB_PATH ??
      path.join(dataDir, 'actualforge-finance.sqlite'),
    actualBaseUrl: parseHttpUrl(
      env.ACTUALFORGE_ACTUAL_URL ?? 'http://actualforge:5006',
    ),
  };
}
