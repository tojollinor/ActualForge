import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  listClarificationCases,
  resolveClarification,
} from './clarifications.js';
import {
  confirmTransactionLink,
  createContract,
  getContract,
} from './contracts.js';
import { openDatabase } from './db.js';
import { suggestTransferMatches } from './transfers.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-clarifications-'));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, 'finance.sqlite'));
}

describe('central clarification workflow', () => {
  it('creates a review after a repeated permanent contract amount change and can apply an edited amount', () => {
    const db = createTestDb();

    const contract = createContract(db, {
      title: 'Internet',
      status: 'active',
      accountId: 'checking',
      amountMinor: 10000,
      amountMode: 'fixed',
      currency: 'EUR',
      recurrence: 'monthly',
      nextPaymentDate: '2026-10-15',
    });

    confirmTransactionLink(db, contract.id, {
      actualTransactionId: 'internet-september',
      amountMinor: -12000,
      date: '2026-09-15',
    });
    confirmTransactionLink(db, contract.id, {
      actualTransactionId: 'internet-october',
      amountMinor: -12000,
      date: '2026-10-15',
    });

    const cases = listClarificationCases(db, 'open');
    const change = cases.find(item => item.kind === 'contract-amount-change');
    expect(change).toBeDefined();
    expect(change?.payload.suggestedAmountMinor).toBe(12000);

    resolveClarification(db, change!.id, {
      action: 'confirm',
      amountMinor: 12500,
    });

    expect(getContract(db, contract.id).amountMinor).toBe(12500);
    expect(
      listClarificationCases(db).find(item => item.id === change!.id)?.status,
    ).toBe('resolved');

    db.close();
  });

  it('collects transfer ambiguity centrally and can dismiss it', () => {
    const db = createTestDb();

    suggestTransferMatches(db, [
      {
        actualTransactionId: 'source',
        date: '2026-10-01',
        amountMinor: -10000,
        accountId: 'checking',
      },
      {
        actualTransactionId: 'target-a',
        date: '2026-10-01',
        amountMinor: 10000,
        accountId: 'savings-a',
      },
      {
        actualTransactionId: 'target-b',
        date: '2026-10-01',
        amountMinor: 10000,
        accountId: 'savings-b',
      },
    ]);

    const cases = listClarificationCases(db, 'open');
    const transferCase = cases.find(item => item.kind === 'transfer-match');
    expect(transferCase).toBeDefined();

    resolveClarification(db, transferCase!.id, { action: 'dismiss' });

    expect(listClarificationCases(db, 'open')).toHaveLength(0);
    expect(
      listClarificationCases(db).find(item => item.id === transferCase!.id)
        ?.status,
    ).toBe('dismissed');

    db.close();
  });
});
