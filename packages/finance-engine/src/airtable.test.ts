import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  syncFinanceEngineToAirtable,
  type AirtableSyncResult,
} from './airtable.js';
import type { AirtableBridgeConfig } from './config.js';
import { openDatabase } from './db.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Airtable bridge', () => {
  it('upserts finance-engine records without exposing the token in payloads', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-airtable-'));
    tempDirs.push(dir);
    const db = openDatabase(path.join(dir, 'finance.sqlite'));

    const now = '2026-10-02T14:00:00.000Z';
    db.prepare(
      `INSERT INTO contracts(
        id, title, kind, status, amount_minor, currency, recurrence, source,
        notes, created_at, updated_at, provider, account_id, amount_mode,
        next_payment_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contract-test',
      'Internet',
      'utility',
      'active',
      4999,
      'EUR',
      'monthly',
      'manual',
      'Test contract',
      now,
      now,
      'Provider',
      'account-test',
      'fixed',
      '2026-10-15',
    );

    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body: unknown;
    }> = [];

    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: input.toString(),
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('authorization'),
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const config: AirtableBridgeConfig = {
      enabled: true,
      token: 'pat_test_secret',
      baseId: 'appDhIt8N6IH2EM5J',
      syncIntervalMinutes: 15,
    };

    const result: AirtableSyncResult = await syncFinanceEngineToAirtable(
      db,
      config,
      fetchImpl,
    );

    expect(result.ok).toBe(true);

    const contractRequest = requests.find(request =>
      request.url.endsWith('/Contracts'),
    );
    expect(contractRequest).toBeDefined();
    expect(contractRequest?.method).toBe('PATCH');
    expect(contractRequest?.authorization).toBe('Bearer pat_test_secret');

    const body = contractRequest?.body as {
      performUpsert: { fieldsToMergeOn: string[] };
      records: Array<{ fields: Record<string, unknown> }>;
    };
    expect(body.performUpsert.fieldsToMergeOn).toEqual(['EngineId']);
    expect(body.records[0].fields).toMatchObject({
      EngineId: 'contract-test',
      Provider: 'Provider',
      ContractType: 'utility',
      AccountId: 'account-test',
      Amount: 49.99,
      Active: true,
      SyncState: 'synced',
    });
    expect(JSON.stringify(body)).not.toContain('pat_test_secret');

    db.close();
  });

  it('marks Airtable records as ignored after their finance-engine row was deleted', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-airtable-delete-'));
    tempDirs.push(dir);
    const db = openDatabase(path.join(dir, 'finance.sqlite'));

    const requests: Array<{
      url: string;
      method: string;
      body: unknown;
    }> = [];

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;

      requests.push({ url, method, body });

      if (method === 'GET' && url.includes('/PredictionEntries?')) {
        return new Response(
          JSON.stringify({
            records: [
              {
                id: 'rec-stale-prediction',
                fields: {
                  EngineId: 'prediction-deleted',
                  RawJSON: '{"id":"prediction-deleted"}',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (method === 'GET') {
        return new Response(JSON.stringify({ records: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await syncFinanceEngineToAirtable(
      db,
      {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(
      result.tables.find(table => table.table === 'PredictionEntries')
        ?.staleRecords,
    ).toBe(1);

    const staleDelete = requests.find(request => {
      if (request.method !== 'DELETE') {
        return false;
      }
      const url = new URL(request.url);
      return (
        url.pathname.endsWith('/PredictionEntries') &&
        url.searchParams.getAll('records[]').includes('rec-stale-prediction')
      );
    });

    expect(staleDelete).toBeDefined();
    db.close();
  });

  it('does not retry permanent Airtable errors in the finance-engine sync', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-airtable-4xx-'));
    tempDirs.push(dir);
    const db = openDatabase(path.join(dir, 'finance.sqlite'));
    let contractListAttempts = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.includes('/Contracts?')) {
        contractListAttempts += 1;
        return new Response(JSON.stringify({ error: 'UNKNOWN_FIELD_NAME' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'GET') {
        return new Response(JSON.stringify({ records: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await syncFinanceEngineToAirtable(
      db,
      {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
      fetchImpl,
    );

    expect(contractListAttempts).toBe(1);
    expect(
      result.tables.find(table => table.table === 'Contracts')?.status,
    ).toBe('error');

    db.close();
  });

});
