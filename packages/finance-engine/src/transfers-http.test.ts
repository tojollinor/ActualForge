import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { FinanceEngineConfig } from './config.js';
import { openDatabase } from './db.js';
import { createFinanceEngineServer } from './server.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('finance-engine transfer HTTP API', () => {
  it('marks a credit-card account and auto-matches its settlement', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-transfer-http-'));
    tempDirs.push(dir);

    const config: FinanceEngineConfig = {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      databasePath: path.join(dir, 'finance.sqlite'),
      actualBaseUrl: 'http://actualforge:5006',
    };

    const db = openDatabase(config.databasePath);
    const server = createFinanceEngineServer({ config, db });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not provide a TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const cardResponse = await fetch(`${baseUrl}/api/v1/credit-cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actualAccountId: 'card',
        fundingAccountId: 'checking',
        label: 'Visa',
      }),
    });
    expect(cardResponse.status).toBe(201);

    const candidates = [
      {
        actualTransactionId: 'purchase',
        date: '2026-09-20',
        amountMinor: -12000,
        accountId: 'card',
      },
      {
        actualTransactionId: 'checking-payment',
        date: '2026-10-01',
        amountMinor: -12000,
        accountId: 'checking',
      },
      {
        actualTransactionId: 'card-payment',
        date: '2026-10-01',
        amountMinor: 12000,
        accountId: 'card',
      },
    ];

    const transferResponse = await fetch(
      `${baseUrl}/api/v1/transfers/suggestions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidates }),
      },
    );
    expect(transferResponse.status).toBe(200);
    const transferResult = (await transferResponse.json()) as {
      matches: Array<{ kind: string; status: string }>;
    };
    expect(transferResult.matches).toHaveLength(1);
    expect(transferResult.matches[0].kind).toBe('credit_card_payment');
    expect(transferResult.matches[0].status).toBe('confirmed');

    const analysis = (await fetch(
      `${baseUrl}/api/v1/credit-cards/analyze`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidates }),
      },
    ).then(res => res.json())) as {
      creditCards: Array<{
        purchaseTotalMinor: number;
        paymentTotalMinor: number;
        economicExpenseMinor: number;
      }>;
    };

    expect(analysis.creditCards[0].purchaseTotalMinor).toBe(12000);
    expect(analysis.creditCards[0].paymentTotalMinor).toBe(12000);
    expect(analysis.creditCards[0].economicExpenseMinor).toBe(12000);

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
