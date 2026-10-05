import { describe, expect, it } from 'vitest';

import {
  createActualCoreAirtableQueue,
  type ActualCoreAirtableStatus,
} from './actual-core-airtable.js';
import type { AirtableBridgeConfig } from './config.js';

async function waitForDrain(
  getStatus: () => ActualCoreAirtableStatus,
): Promise<ActualCoreAirtableStatus> {
  for (let index = 0; index < 100; index += 1) {
    const status = getStatus();
    if (!status.processing && status.pendingBatches === 0) {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Airtable queue did not drain');
}

describe('Actual core Airtable queue', () => {
  it('maps Actual transactions to Airtable without persisting them locally', async () => {
    const requests: Array<{
      url: string;
      method: string;
      body: unknown;
    }> = [];

    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: input.toString(),
        method: init?.method ?? 'GET',
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
      token: 'pat_test',
      baseId: 'appDhIt8N6IH2EM5J',
      syncIntervalMinutes: 15,
    };

    const queue = createActualCoreAirtableQueue(config, fetchImpl);

    const accepted = queue.enqueue({
      syncId: 'sync-1',
      dataset: 'transactions',
      records: [
        {
          id: 'tx-1',
          accountId: 'acct-1',
          date: 20261002,
          amountMinor: -1234,
          payeeId: 'payee-1',
          payeeName: 'Test Shop',
          categoryId: 'cat-1',
          categoryName: 'Shopping',
          cleared: true,
          reconciled: false,
          isTransfer: false,
          isParent: false,
          isChild: false,
          deleted: false,
        },
      ],
    });

    expect(accepted.acceptedRecords).toBe(1);

    const finalStatus = await waitForDrain(queue.getStatus);
    expect(finalStatus.syncedRecords).toBe(1);
    expect(finalStatus.failedRecords).toBe(0);

    const transactionRequest = requests.find(request =>
      request.url.endsWith('/Transactions'),
    );
    expect(transactionRequest).toBeDefined();
    expect(transactionRequest?.method).toBe('PATCH');

    const body = transactionRequest?.body as {
      performUpsert: { fieldsToMergeOn: string[] };
      records: Array<{ fields: Record<string, unknown> }>;
    };

    expect(body.performUpsert.fieldsToMergeOn).toEqual(['ActualId']);
    expect(body.records[0].fields).toMatchObject({
      ActualId: 'tx-1',
      AccountId: 'acct-1',
      Date: '2026-10-02',
      Amount: -12.34,
      Payee: 'Test Shop',
      Category: 'Shopping',
      Cleared: true,
      Reconciled: false,
      IsParent: false,
      IsChild: false,
      CountInTotals: true,
      Deleted: false,
      SyncState: 'synced',
    });
  });

  it('marks tombstones as ignored mirror records', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: input.toString(),
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    };

    const queue = createActualCoreAirtableQueue(
      {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
      fetchImpl,
    );

    queue.enqueue({
      syncId: 'sync-1',
      dataset: 'categories',
      records: [{ id: 'cat-deleted', deleted: true }],
    });

    await waitForDrain(queue.getStatus);

    const categoryRequest = requests.find(request =>
      request.url.endsWith('/Categories'),
    );
    const body = categoryRequest?.body as {
      records: Array<{ fields: Record<string, unknown> }>;
    };
    expect(body.records[0].fields).toMatchObject({
      ActualId: 'cat-deleted',
      Deleted: true,
      SyncState: 'ignored',
    });
  });

  it('does not retry permanent Airtable errors and resets status on the next sync run', async () => {
    let failTransactions = true;
    let transactionAttempts = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input.toString();

      if (url.endsWith('/Transactions')) {
        transactionAttempts += 1;
        if (failTransactions) {
          return new Response(JSON.stringify({ error: 'INVALID_VALUE' }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const queue = createActualCoreAirtableQueue(
      {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
      fetchImpl,
    );

    queue.enqueue({
      syncId: 'sync-failed',
      dataset: 'transactions',
      records: [{ id: 'tx-failed', date: 20261002 }],
    });

    const failed = await waitForDrain(queue.getStatus);
    expect(transactionAttempts).toBe(1);
    expect(failed.failedRecords).toBe(1);
    expect(failed.lastError).toContain('422');

    failTransactions = false;
    queue.enqueue({
      syncId: 'sync-retry',
      dataset: 'transactions',
      records: [{ id: 'tx-retry', date: 20261003 }],
    });

    const recovered = await waitForDrain(queue.getStatus);
    expect(recovered.acceptedRecords).toBe(1);
    expect(recovered.syncedRecords).toBe(1);
    expect(recovered.failedRecords).toBe(0);
    expect(recovered.lastError).toBeNull();
  });

  it('rejects a second sync run while the first one is still queued', async () => {
    let releaseRequest!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseRequest = resolve;
    });

    const fetchImpl: typeof fetch = async (input, init) => {
      if (input.toString().endsWith('/Transactions')) {
        await gate;
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    };

    const queue = createActualCoreAirtableQueue(
      {
        enabled: true,
        token: 'pat_test',
        baseId: 'appDhIt8N6IH2EM5J',
        syncIntervalMinutes: 15,
      },
      fetchImpl,
    );

    queue.enqueue({
      syncId: 'sync-a',
      dataset: 'transactions',
      records: [{ id: 'tx-a' }],
    });

    expect(() =>
      queue.enqueue({
        syncId: 'sync-b',
        dataset: 'transactions',
        records: [{ id: 'tx-b' }],
      }),
    ).toThrow('Another Actual core sync is already in progress');

    releaseRequest();
    await waitForDrain(queue.getStatus);
  });

});
