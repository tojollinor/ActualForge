import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getSchemaVersion, openDatabase } from './db.js';
import { getLatestMigrationVersion } from './migrations.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('finance database', () => {
  it('creates the ActualForge schema without duplicating Actual transactions', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'actualforge-finance-'));
    tempDirs.push(dir);

    const db = openDatabase(path.join(dir, 'finance.sqlite'));

    expect(getSchemaVersion(db)).toBe(getLatestMigrationVersion());

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map(row => row.name);

    expect(tables).toContain('contracts');
    expect(tables).toContain('transaction_links');
    expect(tables).toContain('clarification_cases');
    expect(tables).not.toContain('transactions');

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    expect(foreignKeys).toBe(1);

    db.close();
  });
});
