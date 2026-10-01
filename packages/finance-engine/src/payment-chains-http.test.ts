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

describe('finance-engine payment-chain HTTP API', () => {
  it('creates a chain, links a final payment and keeps splits separate', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-chain-http-'));
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

    const contract = (await fetch(`${baseUrl}/api/v1/contracts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Internet',
        amountMinor: 4999,
        accountId: 'account-1',
        nextPaymentDate: '2026-10-05',
      }),
    }).then(res => res.json())) as { contract: { id: string } };

    const chainResponse = await fetch(`${baseUrl}/api/v1/payment-chains`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractId: contract.contract.id }),
    });
    expect(chainResponse.status).toBe(201);
    const chain = (await chainResponse.json()) as {
      paymentChain: { id: string };
    };

    const linked = await fetch(
      `${baseUrl}/api/v1/payment-chains/${chain.paymentChain.id}/links`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actualTransactionId: 'tx-final',
          role: 'settlement',
          amountMinor: -5499,
          date: '2026-10-08',
          splits: [
            { kind: 'contract_amount', amountMinor: 4999 },
            { kind: 'return_fee', amountMinor: 500 },
          ],
        }),
      },
    );
    expect(linked.status).toBe(200);
    const detail = (await linked.json()) as {
      chain: { status: string };
      summary: { finalPaymentMinor: number; feeTotalMinor: number };
    };
    expect(detail.chain.status).toBe('settled');
    expect(detail.summary.finalPaymentMinor).toBe(4999);
    expect(detail.summary.feeTotalMinor).toBe(500);

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
