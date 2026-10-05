import { randomUUID } from 'node:crypto';

import type { AirtableBridgeConfig } from './config.js';
import type { FinanceDatabase } from './db.js';

type AirtableFieldValue = string | number | boolean | null;
type AirtableFields = Record<string, AirtableFieldValue>;
type SqlRow = Record<string, unknown>;

interface TableSyncDefinition {
  airtableTable: string;
  sqliteTable: string;
  mergeField: string;
  staleStrategy?: 'ignore' | 'delete';
  toFields: (row: SqlRow) => AirtableFields;
}

export interface AirtableTableSyncResult {
  table: string;
  records: number;
  ignoredRecords: number;
  status: 'success' | 'error';
  durationMs: number;
  error?: string;
}

export interface AirtableSyncResult {
  startedAt: string;
  completedAt: string;
  ok: boolean;
  tables: AirtableTableSyncResult[];
}

export interface AirtableSyncController {
  syncNow: (reason?: string) => Promise<AirtableSyncResult>;
  getLastResult: () => AirtableSyncResult | null;
  stop: () => void;
}

function text(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(row: SqlRow, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function minorToMajor(row: SqlRow, key: string): number | null {
  const value = number(row, key);
  return value === null ? null : value / 100;
}

function rawJson(row: SqlRow): string {
  return JSON.stringify(row);
}

function activeStatus(row: SqlRow): boolean {
  return text(row, 'status') === 'active';
}

const TABLES: TableSyncDefinition[] = [
  {
    airtableTable: 'Contracts',
    sqliteTable: 'contracts',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      Provider: text(row, 'provider'),
      ContractType: text(row, 'kind'),
      AccountId: text(row, 'account_id'),
      Amount: minorToMajor(row, 'amount_minor'),
      VariableAmount: text(row, 'amount_mode') === 'variable',
      Interval: text(row, 'recurrence'),
      NextDueDate: text(row, 'next_payment_date'),
      Active: activeStatus(row),
      Notes: text(row, 'notes'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'PaymentChains',
    sqliteTable: 'payment_chains',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      Type: 'payment_chain',
      Status: text(row, 'status'),
      AccountId: text(row, 'account_id'),
      RootTransactionId: null,
      Amount: minorToMajor(row, 'expected_amount_minor'),
      Description: text(row, 'title'),
      Confidence: null,
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'TransactionLinks',
    sqliteTable: 'transaction_links',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      SourceTransactionId: text(row, 'actual_transaction_id'),
      TargetTransactionId: null,
      LinkType: text(row, 'link_type'),
      Confidence: number(row, 'confidence'),
      Confirmed: text(row, 'status') === 'confirmed',
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'TransactionSplits',
    sqliteTable: 'transaction_splits',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      TransactionId: text(row, 'actual_transaction_id'),
      SplitIndex: 0,
      Amount: minorToMajor(row, 'amount_minor'),
      CategoryId: null,
      Description: text(row, 'notes') ?? text(row, 'kind'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'TransferMatches',
    sqliteTable: 'transfer_matches',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      SourceTransactionId: text(row, 'source_actual_transaction_id'),
      TargetTransactionId: text(row, 'target_actual_transaction_id'),
      SourceAccountId: text(row, 'source_account_id'),
      TargetAccountId: text(row, 'target_account_id'),
      Amount: minorToMajor(row, 'amount_minor'),
      Status: text(row, 'status'),
      Confidence: number(row, 'confidence'),
      Notes: text(row, 'metadata_json'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'ClarificationCases',
    sqliteTable: 'clarification_cases',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      CaseType: text(row, 'kind'),
      Status: text(row, 'status'),
      TransactionId: text(row, 'actual_transaction_id'),
      AccountId: null,
      Confidence: number(row, 'confidence'),
      Description: text(row, 'subject'),
      Suggestion: text(row, 'payload_json'),
      Resolution: text(row, 'resolution_json'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'PredictionEntries',
    sqliteTable: 'prediction_entries',
    mergeField: 'EngineId',
    staleStrategy: 'delete',
    toFields: row => ({
      EngineId: text(row, 'id'),
      Date: text(row, 'expected_date'),
      AccountId: text(row, 'account_id'),
      EntryType: text(row, 'source_kind'),
      Description: text(row, 'title'),
      Amount: minorToMajor(row, 'expected_amount_minor'),
      ProjectedBalance: null,
      SourceType: text(row, 'source_kind'),
      SourceId: text(row, 'source_ref'),
      Confidence: number(row, 'confidence'),
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'MerchantMappings',
    sqliteTable: 'merchant_mappings',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      RawMerchant: text(row, 'match_pattern'),
      NormalizedMerchant: text(row, 'normalized_merchant'),
      CategoryId: null,
      Active: activeStatus(row),
      Confidence: null,
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'Rules',
    sqliteTable: 'recognition_rules',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      Name: text(row, 'name'),
      RuleType: 'recognition',
      Enabled: number(row, 'enabled') !== 0,
      Priority: number(row, 'priority'),
      MatchJSON: text(row, 'condition_json'),
      ActionJSON: text(row, 'action_json'),
      Confidence: null,
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'CreditCards',
    sqliteTable: 'credit_card_accounts',
    mergeField: 'ActualAccountId',
    toFields: row => ({
      ActualAccountId: text(row, 'actual_account_id'),
      FundingAccountId: text(row, 'funding_account_id'),
      Label: text(row, 'label'),
      Status: text(row, 'status'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
  {
    airtableTable: 'ContractPriceHistory',
    sqliteTable: 'contract_price_history',
    mergeField: 'EngineId',
    toFields: row => ({
      EngineId: text(row, 'id'),
      ContractId: text(row, 'contract_id'),
      ActualTransactionId: text(row, 'actual_transaction_id'),
      EffectiveDate: text(row, 'effective_date'),
      Amount: minorToMajor(row, 'amount_minor'),
      Currency: text(row, 'currency'),
      Source: text(row, 'source'),
      CreatedAt: text(row, 'created_at'),
      SyncState: 'synced',
      RawJSON: rawJson(row),
    }),
  },
];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

async function airtableRequest(
  config: AirtableBridgeConfig,
  table: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  payload: unknown | undefined,
  fetchImpl: typeof fetch,
  query?: URLSearchParams,
): Promise<unknown> {
  if (!config.token || !config.baseId) {
    throw new Error('Airtable bridge is missing credentials');
  }

  const url =
    'https://api.airtable.com/v0/' +
    encodeURIComponent(config.baseId) +
    '/' +
    encodeURIComponent(table) +
    (query ? `?${query.toString()}` : '');

  let lastError = 'unknown Airtable error';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 3) {
        throw new Error(lastError);
      }
      await delay(500 * 2 ** attempt);
      continue;
    }

    try {
      const responseText = await response.text();
      if (response.ok) {
        if (!responseText) return null;
        try {
          return JSON.parse(responseText) as unknown;
        } catch {
          return responseText;
        }
      }

      lastError = `Airtable ${table} returned ${response.status}: ${responseText.slice(0, 500)}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 3) {
        throw new Error(lastError);
      }

      await delay(
        retryAfterMs(response.headers.get('retry-after')) ?? 500 * 2 ** attempt,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
}

async function upsertTable(
  config: AirtableBridgeConfig,
  definition: TableSyncDefinition,
  rows: SqlRow[],
  fetchImpl: typeof fetch,
): Promise<void> {
  const records = rows.map(row => ({ fields: definition.toFields(row) }));

  for (const batch of chunk(records, 10)) {
    await airtableRequest(
      config,
      definition.airtableTable,
      'PATCH',
      {
        performUpsert: {
          fieldsToMergeOn: [definition.mergeField],
        },
        typecast: true,
        records: batch,
      },
      fetchImpl,
    );
  }
}

async function reconcileMissingRecords(
  config: AirtableBridgeConfig,
  definition: TableSyncDefinition,
  rows: SqlRow[],
  fetchImpl: typeof fetch,
): Promise<number> {
  const staleStrategy = definition.staleStrategy ?? 'ignore';
  const localIds = new Set(
    rows
      .map(row => definition.toFields(row)[definition.mergeField])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
  );

  const staleRecordIds: string[] = [];
  let offset: string | null = null;

  do {
    const query = new URLSearchParams();
    query.set('pageSize', '100');
    query.append('fields[]', definition.mergeField);
    query.append('fields[]', 'RawJSON');
    if (staleStrategy === 'ignore') {
      query.append('fields[]', 'SyncState');
    }
    if (offset) {
      query.set('offset', offset);
    }

    const response = (await airtableRequest(
      config,
      definition.airtableTable,
      'GET',
      undefined,
      fetchImpl,
      query,
    )) as {
      records?: Array<{
        id?: unknown;
        fields?: Record<string, unknown>;
      }>;
      offset?: unknown;
    } | null;

    for (const record of response?.records ?? []) {
      const remoteId = record.fields?.[definition.mergeField];
      const raw = record.fields?.RawJSON;
      const syncState = record.fields?.SyncState;
      const bridgeManaged = typeof raw === 'string' && raw.length > 0;

      if (
        typeof record.id === 'string' &&
        typeof remoteId === 'string' &&
        remoteId.length > 0 &&
        bridgeManaged &&
        !localIds.has(remoteId) &&
        (staleStrategy === 'delete' || syncState === 'synced')
      ) {
        staleRecordIds.push(record.id);
      }
    }

    offset = typeof response?.offset === 'string' ? response.offset : null;
  } while (offset);

  if (staleStrategy === 'delete') {
    for (const batch of chunk(staleRecordIds, 10)) {
      const query = new URLSearchParams();
      for (const recordId of batch) {
        query.append('records[]', recordId);
      }

      await airtableRequest(
        config,
        definition.airtableTable,
        'DELETE',
        undefined,
        fetchImpl,
        query,
      );
    }
  } else {
    for (const batch of chunk(staleRecordIds, 10)) {
      await airtableRequest(
        config,
        definition.airtableTable,
        'PATCH',
        {
          typecast: true,
          records: batch.map(id => ({
            id,
            fields: { SyncState: 'ignored' },
          })),
        },
        fetchImpl,
      );
    }
  }

  return staleRecordIds.length;
}

async function appendSyncLog(
  config: AirtableBridgeConfig,
  result: AirtableTableSyncResult,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    await airtableRequest(
      config,
      'SyncLog',
      'POST',
      {
        typecast: true,
        records: [
          {
            fields: {
              EventId: randomUUID(),
              Timestamp: new Date().toISOString(),
              Direction: 'actualforge_to_airtable',
              EntityType: result.table,
              EntityId: null,
              Status: result.status === 'success' ? 'success' : 'error',
              Message:
                result.status === 'success'
                  ? `Synced ${result.records} record(s), ignored ${result.ignoredRecords} stale record(s)`
                  : result.error ?? 'Airtable sync failed',
              DurationMs: result.durationMs,
              Payload: JSON.stringify({
                records: result.records,
                ignoredRecords: result.ignoredRecords,
                status: result.status,
              }),
            },
          },
        ],
      },
      fetchImpl,
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'airtable sync log write failed',
        table: result.table,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function syncFinanceEngineToAirtable(
  db: FinanceDatabase,
  config: AirtableBridgeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AirtableSyncResult> {
  if (!config.enabled) {
    throw new Error('Airtable bridge is disabled');
  }
  if (!config.token || !config.baseId) {
    throw new Error('Airtable bridge is not configured');
  }

  const startedAt = new Date().toISOString();
  const results: AirtableTableSyncResult[] = [];

  for (const definition of TABLES) {
    const started = Date.now();
    const rows = db
      .prepare(`SELECT * FROM "${definition.sqliteTable}"`)
      .all() as SqlRow[];

    try {
      await upsertTable(config, definition, rows, fetchImpl);
      const ignoredRecords = await reconcileMissingRecords(
        config,
        definition,
        rows,
        fetchImpl,
      );
      const result: AirtableTableSyncResult = {
        table: definition.airtableTable,
        records: rows.length,
        ignoredRecords,
        status: 'success',
        durationMs: Date.now() - started,
      };
      results.push(result);
      await appendSyncLog(config, result, fetchImpl);
    } catch (error) {
      const result: AirtableTableSyncResult = {
        table: definition.airtableTable,
        records: rows.length,
        ignoredRecords: 0,
        status: 'error',
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      await appendSyncLog(config, result, fetchImpl);
    }
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    ok: results.every(result => result.status === 'success'),
    tables: results,
  };
}

export function startAirtableSyncLoop(
  db: FinanceDatabase,
  config: AirtableBridgeConfig,
  fetchImpl: typeof fetch = fetch,
): AirtableSyncController {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<AirtableSyncResult> | null = null;
  let lastResult: AirtableSyncResult | null = null;

  const syncNow = async (reason = 'manual'): Promise<AirtableSyncResult> => {
    if (running) {
      return running;
    }

    running = syncFinanceEngineToAirtable(db, config, fetchImpl)
      .then(result => {
        lastResult = result;
        console.log(
          JSON.stringify({
            level: result.ok ? 'info' : 'warn',
            message: 'airtable bridge sync completed',
            reason,
            ok: result.ok,
            tables: result.tables.map(table => ({
              table: table.table,
              records: table.records,
              ignoredRecords: table.ignoredRecords,
              status: table.status,
            })),
          }),
        );
        return result;
      })
      .catch(error => {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'airtable bridge sync failed',
            reason,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      })
      .finally(() => {
        running = null;
      });

    return running;
  };

  if (config.enabled) {
    void syncNow('startup').catch(() => undefined);

    if (config.syncIntervalMinutes > 0) {
      timer = setInterval(() => {
        if (!stopped) {
          void syncNow('interval').catch(() => undefined);
        }
      }, config.syncIntervalMinutes * 60_000);
      timer.unref();
    }
  }

  return {
    syncNow,
    getLastResult: () => lastResult,
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
