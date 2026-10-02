import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ActualCoreAirtableQueue,
  ActualCoreAirtableStatus,
} from './actual-core-airtable.js';
import type { FinanceEngineConfig } from './config.js';
import { openDatabase } from './db.js';
import { createFinanceEngineServer } from './server.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Actual core Airtable HTTP API', () => {
  it('accepts authenticated-proxy batches into the Airtable queue', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-core-http-'));
    tempDirs.push(dir);

    const config: FinanceEngineConfig = {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      databasePath: path.join(dir, 'finance.sqlite'),
      actualBaseUrl: 'http://actualforge:5006',
      airtable: {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
    };

    let acceptedDataset = '';
    let acceptedRecords = 0;
    const status: ActualCoreAirtableStatus = {
      enabled: true,
      configured: true,
      pendingBatches: 1,
      processing: false,
      acceptedRecords: 2,
      syncedRecords: 0,
      failedRecords: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    };
    const actualCoreAirtable: ActualCoreAirtableQueue = {
      enqueue: input => {
        acceptedDataset = input.dataset;
        acceptedRecords = input.records.length;
        return status;
      },
      getStatus: () => status,
    };

    const db = openDatabase(config.databasePath);
    const server = createFinanceEngineServer({
      config,
      db,
      actualCoreAirtable,
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not provide a TCP address');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/v1/airtable/core-batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dataset: 'accounts',
        records: [
          { id: 'acct-1', name: 'Checking' },
          { id: 'acct-2', name: 'Savings' },
        ],
      }),
    });

    expect(response.status).toBe(202);
    expect(acceptedDataset).toBe('accounts');
    expect(acceptedRecords).toBe(2);

    const airtableStatus = await fetch(
      `${baseUrl}/api/v1/airtable/status`,
    ).then(result => result.json());
    expect(airtableStatus).toMatchObject({
      enabled: true,
      configured: true,
      pendingBatches: 1,
      acceptedRecords: 2,
    });

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
