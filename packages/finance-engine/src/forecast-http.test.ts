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

describe('finance-engine forecast HTTP API', () => {
  it('creates a manual prediction and includes it in a forecast', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-forecast-http-'));
    tempDirs.push(dir);

    const config: FinanceEngineConfig = {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      databasePath: path.join(dir, 'finance.sqlite'),
      actualBaseUrl: 'http://actualforge:5006',
      airtable: {
        enabled: false,
        token: null,
        baseId: null,
        syncIntervalMinutes: 15,
      },
    };

    const db = openDatabase(config.databasePath);
    const server = createFinanceEngineServer({ config, db });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not provide a TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const predictionResponse = await fetch(`${baseUrl}/api/v1/predictions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Werkstatt',
        accountId: 'checking',
        expectedDate: '2026-10-20',
        amountMinor: -15000,
        currency: 'EUR',
      }),
    });
    expect(predictionResponse.status).toBe(201);

    const forecastResponse = await fetch(
      `${baseUrl}/api/v1/forecast/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: '2026-10-02',
          endDate: '2026-10-31',
          accounts: [
            {
              accountId: 'checking',
              accountName: 'Girokonto',
              balanceMinor: 100000,
            },
          ],
          scheduleEvents: [
            {
              sourceRef: 'salary-october',
              accountId: 'checking',
              accountName: 'Girokonto',
              title: 'Gehalt',
              date: '2026-10-15',
              amountMinor: 200000,
            },
          ],
        }),
      },
    );
    expect(forecastResponse.status).toBe(200);

    const forecast = (await forecastResponse.json()) as {
      summary: {
        totalStartBalanceMinor: number;
        totalEndBalanceMinor: number;
      };
      entries: Array<{ sourceKind: string; amountMinor: number }>;
    };

    expect(forecast.summary.totalStartBalanceMinor).toBe(100000);
    expect(forecast.summary.totalEndBalanceMinor).toBe(285000);
    expect(
      forecast.entries.some(
        entry =>
          entry.sourceKind === 'manual' && entry.amountMinor === -15000,
      ),
    ).toBe(true);
    expect(
      forecast.entries.some(
        entry =>
          entry.sourceKind === 'actual_schedule' &&
          entry.amountMinor === 200000,
      ),
    ).toBe(true);

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
