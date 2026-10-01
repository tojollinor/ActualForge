import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  confirmTransactionLink,
  createContract,
  getContractDetail,
  suggestContractLinks,
  updateContract,
} from './contracts.js';
import { openDatabase } from './db.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-contracts-'));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, 'finance.sqlite'));
}

describe('contract management', () => {
  it('creates and updates the full contract profile', () => {
    const db = createTestDb();

    const contract = createContract(db, {
      title: 'Fiber 1000',
      provider: 'ExampleTel',
      kind: 'telecom',
      status: 'active',
      accountId: 'account-1',
      payeeId: 'payee-1',
      amountMinor: 4999,
      amountMode: 'fixed',
      currency: 'EUR',
      recurrence: 'monthly',
      nextPaymentDate: '2026-10-15',
      startDate: '2026-01-01',
      minimumTermMonths: 24,
      cancellationNoticeDays: 30,
      notes: 'Main internet contract',
    });

    expect(contract.provider).toBe('ExampleTel');
    expect(contract.amountMinor).toBe(4999);
    expect(contract.amountMode).toBe('fixed');

    const updated = updateContract(db, contract.id, {
      amountMinor: 5299,
      cancellationDate: '2027-12-01',
    });

    expect(updated.amountMinor).toBe(5299);
    expect(updated.cancellationDate).toBe('2027-12-01');

    db.close();
  });

  it('proposes recurring matches without changing the Actual transaction', () => {
    const db = createTestDb();

    const contract = createContract(db, {
      title: 'Music',
      provider: 'StreamCo',
      accountId: 'account-1',
      payeeId: 'payee-1',
      amountMinor: 1299,
      amountMode: 'fixed',
      currency: 'EUR',
      recurrence: 'monthly',
      nextPaymentDate: '2026-10-05',
    });

    const [suggestion] = suggestContractLinks(db, contract.id, [
      {
        actualTransactionId: 'actual-tx-1',
        date: '2026-10-05',
        amountMinor: -1299,
        accountId: 'account-1',
        payeeId: 'payee-1',
        payeeName: 'StreamCo',
      },
    ]);

    expect(suggestion.actualTransactionId).toBe('actual-tx-1');
    expect(suggestion.score).toBeGreaterThanOrEqual(0.9);
    expect(suggestion.proposedLinkId).not.toBeNull();

    const proposed = getContractDetail(db, contract.id).links[0];
    expect(proposed.status).toBe('proposed');
    expect(proposed.actualTransactionId).toBe('actual-tx-1');

    db.close();
  });

  it('records price history when a proposed transaction is confirmed', () => {
    const db = createTestDb();

    const contract = createContract(db, {
      title: 'Cloud storage',
      provider: 'CloudBox',
      amountMinor: 999,
      amountMode: 'fixed',
      currency: 'EUR',
    });

    confirmTransactionLink(db, contract.id, {
      actualTransactionId: 'actual-tx-2',
      amountMinor: -1099,
      date: '2026-10-01',
      confidence: 0.85,
      metadata: { amountChange: true },
    });

    const detail = getContractDetail(db, contract.id);
    expect(detail.links[0].status).toBe('confirmed');
    expect(detail.priceHistory).toHaveLength(1);
    expect(detail.priceHistory[0].amountMinor).toBe(1099);

    db.close();
  });
});
