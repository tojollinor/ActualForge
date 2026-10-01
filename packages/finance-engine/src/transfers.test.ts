import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './db.js';
import {
  analyzeCreditCards,
  listTransferMatches,
  removeTransferMatch,
  suggestTransferMatches,
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-transfers-'));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, 'finance.sqlite'));
}

describe('transfer and credit-card interpretation', () => {
  it('auto-confirms explicit Actual transfers and keeps them economically neutral', () => {
    const db = createTestDb();

    const result = suggestTransferMatches(db, [
      {
        actualTransactionId: 'tx-checking',
        transferId: 'tx-savings',
        date: '2026-10-01',
        amountMinor: -50000,
        accountId: 'checking',
        accountName: 'Girokonto',
      },
      {
        actualTransactionId: 'tx-savings',
        transferId: 'tx-checking',
        date: '2026-10-01',
        amountMinor: 50000,
        accountId: 'savings',
        accountName: 'Tagesgeld',
      },
    ]);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].status).toBe('confirmed');
    expect(result.suggestions[0].kind).toBe('internal_transfer');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].amountMinor).toBe(50000);
    expect(result.matches[0].sourceActualTransactionId).toBe('tx-checking');
    expect(result.matches[0].targetActualTransactionId).toBe('tx-savings');

    removeTransferMatch(db, result.matches[0].id);
    expect(listTransferMatches(db)).toHaveLength(0);

    db.close();
  });

  it('recognizes credit-card settlement without counting the checking debit as new spending', () => {
    const db = createTestDb();

    upsertCreditCardProfile(db, {
      actualAccountId: 'card',
      fundingAccountId: 'checking',
      label: 'Visa',
    });

    const candidates = [
      {
        actualTransactionId: 'purchase-1',
        date: '2026-09-20',
        amountMinor: -7000,
        accountId: 'card',
        payeeName: 'Shop A',
      },
      {
        actualTransactionId: 'purchase-2',
        date: '2026-09-25',
        amountMinor: -5000,
        accountId: 'card',
        payeeName: 'Shop B',
      },
      {
        actualTransactionId: 'checking-payment',
        date: '2026-10-01',
        amountMinor: -12000,
        accountId: 'checking',
        accountName: 'Girokonto',
      },
      {
        actualTransactionId: 'card-payment',
        date: '2026-10-01',
        amountMinor: 12000,
        accountId: 'card',
        accountName: 'Visa',
      },
    ];

    const result = suggestTransferMatches(db, candidates);
    expect(result.suggestions[0].status).toBe('confirmed');
    expect(result.suggestions[0].kind).toBe('credit_card_payment');

    const [analysis] = analyzeCreditCards(db, candidates);
    expect(analysis.purchaseCount).toBe(2);
    expect(analysis.purchaseTotalMinor).toBe(12000);
    expect(analysis.paymentCount).toBe(1);
    expect(analysis.paymentTotalMinor).toBe(12000);
    expect(analysis.economicExpenseMinor).toBe(12000);

    db.close();
  });

  it('sends ambiguous same-amount transfers to clarification instead of auto-linking', () => {
    const db = createTestDb();

    const result = suggestTransferMatches(db, [
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

    expect(result.matches).toHaveLength(0);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].status).toBe('clarification');
    expect(result.suggestions[0].clarificationCaseId).not.toBeNull();
    expect(result.clarifications[0].status).toBe('open');

    db.close();
  });
});
