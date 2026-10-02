import { randomUUID } from 'node:crypto';

import type { AirtableBridgeConfig } from './config.js';

type AirtableFieldValue = string | number | boolean | null;
type AirtableFields = Record<string, AirtableFieldValue>;
type CoreRecord = Record<string, unknown>;

export type ActualCoreDataset =
  | 'accounts'
  | 'transactions'
  | 'categories'
  | 'schedules';

export interface ActualCoreBatchInput {
  dataset: ActualCoreDataset;
  records: CoreRecord[];
}

export interface ActualCoreAirtableStatus {
  enabled: boolean;
  configured: boolean;
  pendingBatches: number;
  processing: boolean;
  acceptedRecords: number;
  syncedRecords: number;
  failedRecords: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface ActualCoreAirtableQueue {
  enqueue: (input: ActualCoreBatchInput) => ActualCoreAirtableStatus;
  getStatus: () => ActualCoreAirtableStatus;
}

interface CoreSyncDefinition {
  table: string;
  mergeField: string;
  toFields: (row: CoreRecord) => AirtableFields;
}

function text(row: CoreRecord, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(row: CoreRecord, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolean(row: CoreRecord, key: string): boolean {
  return row[key] === true || row[key] === 1;
}

function minorToMajor(row: CoreRecord, key: string): number | null {
  const value = number(row, key);
  return value === null ? null : value / 100;
}

function rawJson(row: CoreRecord): string {
  return JSON.stringify(row);
}

function syncState(row: CoreRecord): string {
  return boolean(row, 'deleted') ? 'ignored' : 'synced';
}

const DEFINITIONS: Record<ActualCoreDataset, CoreSyncDefinition> = {
  accounts: {
    table: 'Accounts',
    mergeField: 'ActualId',
    toFields: row => ({
      ActualId: text(row, 'id'),
      Name: text(row, 'name'),
      Type: text(row, 'type'),
      Institution: text(row, 'institution'),
      Currency: text(row, 'currency') ?? 'EUR',
      Balance: minorToMajor(row, 'balanceMinor'),
      ClearedBalance: minorToMajor(row, 'clearedBalanceMinor'),
      Closed: boolean(row, 'closed'),
      OffBudget: boolean(row, 'offBudget'),
      AccountSyncSource: text(row, 'accountSyncSource'),
      LastSync: text(row, 'lastSync'),
      Deleted: boolean(row, 'deleted'),
      SyncState: syncState(row),
      LastBridgeSync: new Date().toISOString(),
      RawJSON: rawJson(row),
    }),
  },
  transactions: {
    table: 'Transactions',
    mergeField: 'ActualId',
    toFields: row => ({
      ActualId: text(row, 'id'),
      AccountId: text(row, 'accountId'),
      Date: text(row, 'date'),
      Amount: minorToMajor(row, 'amountMinor'),
      PayeeId: text(row, 'payeeId'),
      Payee: text(row, 'payeeName'),
      Category: text(row, 'categoryName'),
      CategoryId: text(row, 'categoryId'),
      Notes: text(row, 'notes'),
      Cleared: boolean(row, 'cleared'),
      Reconciled: boolean(row, 'reconciled'),
      ImportedId: text(row, 'importedId'),
      TransferId: text(row, 'transferId'),
      TransferAccountId: text(row, 'transferAccountId'),
      IsTransfer: boolean(row, 'isTransfer'),
      IsParent: boolean(row, 'isParent'),
      IsChild: boolean(row, 'isChild'),
      CountInTotals: !boolean(row, 'isChild'),
      ParentId: text(row, 'parentId'),
      ScheduleId: text(row, 'scheduleId'),
      Deleted: boolean(row, 'deleted'),
      SyncState: syncState(row),
      LastBridgeSync: new Date().toISOString(),
      RawJSON: rawJson(row),
    }),
  },
  categories: {
    table: 'Categories',
    mergeField: 'ActualId',
    toFields: row => ({
      ActualId: text(row, 'id'),
      Name: text(row, 'name'),
      GroupName: text(row, 'groupName'),
      GroupId: text(row, 'groupId'),
      Hidden: boolean(row, 'hidden'),
      IsIncome: boolean(row, 'isIncome'),
      Deleted: boolean(row, 'deleted'),
      SyncState: syncState(row),
      RawJSON: rawJson(row),
    }),
  },
  schedules: {
    table: 'Schedules',
    mergeField: 'ActualId',
    toFields: row => ({
      ActualId: text(row, 'id'),
      Name: text(row, 'name'),
      AccountId: text(row, 'accountId'),
      PayeeId: text(row, 'payeeId'),
      Payee: text(row, 'payeeName'),
      CategoryId: text(row, 'categoryId'),
      Amount: minorToMajor(row, 'amountMinor'),
      NextDate: text(row, 'nextDate'),
      Rule: text(row, 'rule'),
      Active: boolean(row, 'active'),
      Completed: boolean(row, 'completed'),
      PostsTransaction: boolean(row, 'postsTransaction'),
      Deleted: boolean(row, 'deleted'),
      SyncState: syncState(row),
      RawJSON: rawJson(row),
    }),
  },
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function airtableRequest(
  config: AirtableBridgeConfig,
  table: string,
  method: 'POST' | 'PATCH',
  payload: unknown,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (!config.token || !config.baseId) {
    throw new Error('Airtable bridge is missing credentials');
  }

  const url =
    'https://api.airtable.com/v0/' +
    encodeURIComponent(config.baseId) +
    '/' +
    encodeURIComponent(table);

  let lastError = 'unknown Airtable error';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      if (response.ok) {
        return;
      }

      lastError = `Airtable ${table} returned ${response.status}: ${responseText.slice(0, 500)}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 4) {
        throw new Error(lastError);
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 750 * 2 ** attempt,
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 4) {
        throw new Error(lastError);
      }
      await delay(750 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
}

async function appendSyncLog(
  config: AirtableBridgeConfig,
  dataset: ActualCoreDataset,
  records: number,
  status: 'success' | 'error',
  durationMs: number,
  error: string | null,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    const definition = DEFINITIONS[dataset];
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
              EntityType: definition.table,
              EntityId: null,
              Status: status,
              Message:
                status === 'success'
                  ? `Synced ${records} Actual core record(s)`
                  : error ?? 'Actual core Airtable sync failed',
              DurationMs: durationMs,
              Payload: JSON.stringify({
                source: 'actual-core-snapshot',
                dataset,
                records,
                status,
              }),
            },
          },
        ],
      },
      fetchImpl,
    );
  } catch (logError) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'actual core Airtable sync log write failed',
        dataset,
        error:
          logError instanceof Error ? logError.message : String(logError),
      }),
    );
  }
}

async function syncBatch(
  config: AirtableBridgeConfig,
  input: ActualCoreBatchInput,
  fetchImpl: typeof fetch,
): Promise<void> {
  const definition = DEFINITIONS[input.dataset];
  const started = Date.now();

  try {
    const records = input.records.map(row => ({
      fields: definition.toFields(row),
    }));

    for (const [index, batch] of chunk(records, 10).entries()) {
      await airtableRequest(
        config,
        definition.table,
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

      if (index < Math.ceil(records.length / 10) - 1) {
        await delay(225);
      }
    }

    await appendSyncLog(
      config,
      input.dataset,
      input.records.length,
      'success',
      Date.now() - started,
      null,
      fetchImpl,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendSyncLog(
      config,
      input.dataset,
      input.records.length,
      'error',
      Date.now() - started,
      message,
      fetchImpl,
    );
    throw error;
  }
}

export function createActualCoreAirtableQueue(
  config: AirtableBridgeConfig,
  fetchImpl: typeof fetch = fetch,
): ActualCoreAirtableQueue {
  let queue = Promise.resolve();
  let pendingBatches = 0;
  let processing = false;
  let acceptedRecords = 0;
  let syncedRecords = 0;
  let failedRecords = 0;
  let lastSuccessAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastError: string | null = null;

  const getStatus = (): ActualCoreAirtableStatus => ({
    enabled: config.enabled,
    configured: Boolean(config.token && config.baseId),
    pendingBatches,
    processing,
    acceptedRecords,
    syncedRecords,
    failedRecords,
    lastSuccessAt,
    lastErrorAt,
    lastError,
  });

  const enqueue = (input: ActualCoreBatchInput): ActualCoreAirtableStatus => {
    if (!config.enabled) {
      throw new Error('Airtable bridge is disabled');
    }
    if (!config.token || !config.baseId) {
      throw new Error('Airtable bridge is not configured');
    }
    if (!(input.dataset in DEFINITIONS)) {
      throw new Error('Unsupported Actual core dataset');
    }
    if (!Array.isArray(input.records) || input.records.length > 250) {
      throw new Error('Actual core batches must contain at most 250 records');
    }
    if (
      input.records.some(
        row => !row || typeof row !== 'object' || !text(row, 'id'),
      )
    ) {
      throw new Error('Every Actual core record requires an id');
    }

    pendingBatches += 1;
    acceptedRecords += input.records.length;

    queue = queue
      .catch(() => undefined)
      .then(async () => {
        processing = true;
        try {
          await syncBatch(config, input, fetchImpl);
          syncedRecords += input.records.length;
          lastSuccessAt = new Date().toISOString();
        } catch (error) {
          failedRecords += input.records.length;
          lastErrorAt = new Date().toISOString();
          lastError = error instanceof Error ? error.message : String(error);
          console.error(
            JSON.stringify({
              level: 'error',
              message: 'actual core Airtable batch failed',
              dataset: input.dataset,
              records: input.records.length,
              error: lastError,
            }),
          );
        } finally {
          pendingBatches -= 1;
          processing = pendingBatches > 0;
        }
      });

    return getStatus();
  };

  return {
    enqueue,
    getStatus,
  };
}
