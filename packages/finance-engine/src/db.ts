import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { runMigrations } from './migrations.js';

export type FinanceDatabase = Database.Database;

export function openDatabase(databasePath: string): FinanceDatabase {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

export function getSchemaVersion(db: FinanceDatabase): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number };

  return row.version;
}

export function checkDatabase(db: FinanceDatabase): boolean {
  const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
  return row.ok === 1;
}
