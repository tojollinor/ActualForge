import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContract } from './contracts.js';
import { openDatabase } from './db.js';
import {
  confirmPaymentChainLink,
  createPaymentChain,
  getPaymentChainDetail,
  removePaymentChainLink,
  replacePaymentChainSplits,
  resolveClarificationCase,
  suggestPaymentChainLinks,
} from './payment-chains.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-chains-'));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, 'finance.sqlite'));
}

describe('payment chains', () => {
  it('recognizes debit, reversal and retry as one economic payment chain', () => {
    const db = createTestDb();
    const contract = createContract(db, {
      title: 'Internet',
      provider: 'ExampleTel',
      accountId: 'account-1',
      amountMinor: 4999,
      nextPaymentDate: '2026-10-05',
    });
    const chain = createPaymentChain(db, { contractId: contract.id });

    const suggestions = suggestPaymentChainLinks(db, chain.id, [
      {
        actualTransactionId: 'tx-first',
        date: '2026-10-05',
        amountMinor: -4999,
        accountId: 'account-1',
        payeeName: 'ExampleTel',
      },
      {
        actualTransactionId: 'tx-return',
        date: '2026-10-08',
        amountMinor: 4999,
        accountId: 'account-1',
        payeeName: 'ExampleTel',
      },
      {
        actualTransactionId: 'tx-retry',
        date: '2026-10-12',
        amountMinor: -4999,
        accountId: 'account-1',
        payeeName: 'ExampleTel',
      },
    ]);

    expect(
      suggestions.find(item => item.actualTransactionId === 'tx-first')?.role,
    ).toBe('payment_attempt');
    expect(
      suggestions.find(item => item.actualTransactionId === 'tx-return')?.role,
    ).toBe('reversal');
    expect(
      suggestions.find(item => item.actualTransactionId === 'tx-retry')?.role,
    ).toBe('settlement');

    for (const suggestion of suggestions) {
      const candidate =
        suggestion.actualTransactionId === 'tx-first'
          ? { amountMinor: -4999, date: '2026-10-05' }
          : suggestion.actualTransactionId === 'tx-return'
            ? { amountMinor: 4999, date: '2026-10-08' }
            : { amountMinor: -4999, date: '2026-10-12' };

      if (!suggestion.clarificationCaseId) {
        confirmPaymentChainLink(db, chain.id, {
          actualTransactionId: suggestion.actualTransactionId,
          role: suggestion.role,
          amountMinor: candidate.amountMinor,
          date: candidate.date,
          confidence: suggestion.score,
        });
      }
    }

    const detail = getPaymentChainDetail(db, chain.id);
    expect(detail.chain.status).toBe('settled');
    expect(detail.summary.finalPaymentMinor).toBe(4999);
    expect(detail.summary.reversalCount).toBe(1);
    expect(detail.summary.attemptCount).toBe(2);

    db.close();
  });

  it('keeps fees separate from the final contract amount with reversible splits', () => {
    const db = createTestDb();
    const contract = createContract(db, {
      title: 'Insurance',
      amountMinor: 10000,
      nextPaymentDate: '2026-10-01',
    });
    const chain = createPaymentChain(db, { contractId: contract.id });

    const link = confirmPaymentChainLink(db, chain.id, {
      actualTransactionId: 'tx-final',
      role: 'settlement',
      amountMinor: -11250,
      date: '2026-10-03',
      splits: [
        { kind: 'contract_amount', amountMinor: 10000 },
        { kind: 'return_fee', amountMinor: 750 },
        { kind: 'dunning_fee', amountMinor: 500 },
      ],
    });

    let detail = getPaymentChainDetail(db, chain.id);
    expect(detail.summary.finalPaymentMinor).toBe(10000);
    expect(detail.summary.feeTotalMinor).toBe(1250);
    expect(detail.summary.economicTotalMinor).toBe(11250);

    replacePaymentChainSplits(db, chain.id, link.id, [
      { kind: 'contract_amount', amountMinor: 10000 },
      { kind: 'bank_fee', amountMinor: 1250 },
    ]);
    detail = getPaymentChainDetail(db, chain.id);
    expect(detail.links[0].splits.map(split => split.kind)).toEqual([
      'contract_amount',
      'bank_fee',
    ]);

    removePaymentChainLink(db, chain.id, link.id);
    detail = getPaymentChainDetail(db, chain.id);
    expect(detail.chain.status).toBe('open');
    expect(detail.summary.finalPaymentMinor).toBe(0);

    db.close();
  });

  it('stores uncertain matches as clarification cases that can be dismissed', () => {
    const db = createTestDb();
    const contract = createContract(db, {
      title: 'Gym',
      amountMinor: 3000,
      accountId: 'account-1',
      nextPaymentDate: '2026-10-10',
    });
    const chain = createPaymentChain(db, { contractId: contract.id });

    const [suggestion] = suggestPaymentChainLinks(db, chain.id, [
      {
        actualTransactionId: 'tx-uncertain',
        date: '2026-10-10',
        amountMinor: -3000,
        accountId: 'account-1',
        payeeName: 'Unknown',
      },
    ]);

    expect(suggestion.clarificationCaseId).not.toBeNull();
    let detail = getPaymentChainDetail(db, chain.id);
    expect(detail.chain.status).toBe('needs_clarification');
    expect(detail.clarifications[0].status).toBe('open');

    resolveClarificationCase(
      db,
      chain.id,
      suggestion.clarificationCaseId!,
      { action: 'dismiss' },
    );

    detail = getPaymentChainDetail(db, chain.id);
    expect(detail.clarifications[0].status).toBe('dismissed');
    expect(detail.chain.status).toBe('open');

    db.close();
  });
});
