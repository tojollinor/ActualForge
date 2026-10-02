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
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('finance-engine HTTP API', () => {
  it('serves health, readiness and integration status', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-finance-'));
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

    const health = await fetch(`${baseUrl}/health`).then(response =>
      response.json(),
    );
    expect(health).toMatchObject({
      status: 'ok',
      service: 'finance-engine',
    });

    const readyResponse = await fetch(`${baseUrl}/ready`);
    expect(readyResponse.status).toBe(200);

    const status = await fetch(`${baseUrl}/api/v1/status`).then(response =>
      response.json(),
    );
    expect(status).toMatchObject({
      persistence: 'sqlite',
      actualIntegration: {
        transactionStorage: 'reference-by-id',
        automaticTransactionMutation: false,
      },
    });

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
