import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContract } from './contracts.js';
import { openDatabase } from './db.js';
import {
  createPrediction,
  generateForecast,
} from './forecast.js';
import {
  confirmTransferMatch,
  upsertCreditCardProfile,
} from './transfers.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-forecast-'));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, 'finance.sqlite'));
}

describe('forecast engine', () => {
  it('combines balances, Actual schedules, contracts and manual predictions without double-counting', () => {
    const db = createTestDb();

    createContract(db, {
      title: 'Internet',
      status: 'active',
      accountId: 'checking',
      amountMinor: 5000,
      amountMode: 'fixed',
      currency: 'EUR',
      recurrence: 'monthly',
      nextPaymentDate: '2026-10-15',
    });

    createPrediction(db, {
      title: 'Werkstatt',
      accountId: 'checking',
      expectedDate: '2026-11-01',
      amountMinor: -10000,
      currency: 'EUR',
    });

    const result = generateForecast(db, {
      startDate: '2026-10-02',
      endDate: '2026-11-30',
      accounts: [
        {
          accountId: 'checking',
          accountName: 'Girokonto',
          balanceMinor: 100000,
        },
      ],
      scheduleEvents: [
        {
          sourceRef: 'internet:2026-10-15',
          accountId: 'checking',
          accountName: 'Girokonto',
          title: 'Internet',
          date: '2026-10-15',
          amountMinor: -5000,
        },
        {
          sourceRef: 'salary:2026-10-31',
          accountId: 'checking',
          accountName: 'Girokonto',
          title: 'Gehalt',
          date: '2026-10-31',
          amountMinor: 200000,
        },
      ],
    });

    expect(
      result.entries.filter(
        entry =>
          entry.date === '2026-10-15' &&
          Math.abs(entry.amountMinor) === 5000,
      ),
    ).toHaveLength(1);
    expect(
      result.entries.some(
        entry =>
          entry.sourceKind === 'contract' &&
          entry.date === '2026-11-15' &&
          entry.amountMinor === -5000,
      ),
    ).toBe(true);
    expect(
      result.entries.some(
        entry =>
          entry.sourceKind === 'manual' &&
          entry.amountMinor === -10000,
      ),
    ).toBe(true);
    expect(result.summary.totalEndBalanceMinor).toBe(280000);

    db.close();
  });

  it('projects a credit-card settlement as an internal balance move', () => {
    const db = createTestDb();

    upsertCreditCardProfile(db, {
      actualAccountId: 'card',
      fundingAccountId: 'checking',
      label: 'Visa',
    });

    confirmTransferMatch(db, {
      source: {
        actualTransactionId: 'checking-september-payment',
        date: '2026-09-30',
        amountMinor: -12000,
        accountId: 'checking',
      },
      target: {
        actualTransactionId: 'card-september-payment',
        date: '2026-09-30',
        amountMinor: 12000,
        accountId: 'card',
      },
      kind: 'credit_card_payment',
    });

    const result = generateForecast(db, {
      startDate: '2026-10-02',
      endDate: '2026-11-30',
      accounts: [
        {
          accountId: 'checking',
          accountName: 'Girokonto',
          balanceMinor: 100000,
        },
        {
          accountId: 'card',
          accountName: 'Visa',
          balanceMinor: -3000,
        },
      ],
      transactionCandidates: [
        {
          actualTransactionId: 'card-purchase-october',
          date: '2026-10-05',
          amountMinor: -3000,
          accountId: 'card',
          payeeName: 'Shop',
        },
      ],
    });

    const cardEntries = result.entries.filter(
      entry => entry.sourceKind === 'credit_card_settlement',
    );
    expect(cardEntries).toHaveLength(2);
    expect(cardEntries.map(entry => entry.amountMinor).sort((a, b) => a - b)).toEqual([
      -3000,
      3000,
    ]);
    expect(result.summary.totalStartBalanceMinor).toBe(97000);
    expect(result.summary.totalEndBalanceMinor).toBe(97000);

    db.close();
  });
});
