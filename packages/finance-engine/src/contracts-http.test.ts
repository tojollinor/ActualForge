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

describe('finance-engine contract HTTP API', () => {
  it('creates, lists and reads contracts', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-http-'));
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
    const createdResponse = await fetch(`${baseUrl}/api/v1/contracts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Internet',
        provider: 'ExampleTel',
        amountMinor: 4999,
        amountMode: 'fixed',
        currency: 'EUR',
      }),
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      contract: { id: string; provider: string };
    };
    expect(created.contract.provider).toBe('ExampleTel');

    const listed = (await fetch(`${baseUrl}/api/v1/contracts`).then(res =>
      res.json(),
    )) as { contracts: Array<{ id: string }> };
    expect(listed.contracts.some(item => item.id === created.contract.id)).toBe(
      true,
    );

    const detail = await fetch(
      `${baseUrl}/api/v1/contracts/${created.contract.id}`,
    );
    expect(detail.status).toBe(200);

    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    db.close();
  });
});
