import { existsSync } from 'node:fs';
import path from 'node:path';

export interface AirtableBridgeConfig {
  enabled: boolean;
  token: string | null;
  baseId: string | null;
  syncIntervalMinutes: number;
}

export interface FinanceEngineConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  actualBaseUrl: string;
  airtable: AirtableBridgeConfig;
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

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new Error(`Invalid ${name}: ${value}`);
  }
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function loadAirtableConfig(env: NodeJS.ProcessEnv): AirtableBridgeConfig {
  const enabled = parseBoolean(
    env.AIRTABLE_SYNC_ENABLED,
    false,
    'AIRTABLE_SYNC_ENABLED',
  );
  const token = env.AIRTABLE_TOKEN?.trim() || null;
  const baseId = env.AIRTABLE_BASE_ID?.trim() || null;
  const syncIntervalMinutes = parseNonNegativeInteger(
    env.AIRTABLE_SYNC_INTERVAL_MINUTES,
    15,
    'AIRTABLE_SYNC_INTERVAL_MINUTES',
  );

  if (baseId && !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new Error('AIRTABLE_BASE_ID must be a valid Airtable base ID');
  }

  if (enabled && !token) {
    throw new Error('AIRTABLE_TOKEN is required when Airtable sync is enabled');
  }

  if (enabled && !baseId) {
    throw new Error('AIRTABLE_BASE_ID is required when Airtable sync is enabled');
  }

  return {
    enabled,
    token,
    baseId,
    syncIntervalMinutes,
  };
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
    airtable: loadAirtableConfig(env),
  };
}
