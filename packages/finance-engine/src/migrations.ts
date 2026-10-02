import Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-actualforge-domain',
    sql: `
      CREATE TABLE IF NOT EXISTS engine_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        start_date TEXT,
        end_date TEXT,
        amount_minor INTEGER,
        currency TEXT,
        recurrence TEXT,
        source TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_chains (
        id TEXT PRIMARY KEY,
        contract_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        expected_amount_minor INTEGER,
        currency TEXT,
        due_date TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS transaction_links (
        id TEXT PRIMARY KEY,
        actual_transaction_id TEXT NOT NULL,
        contract_id TEXT,
        payment_chain_id TEXT,
        link_type TEXT NOT NULL,
        amount_minor INTEGER,
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'proposed',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL,
        FOREIGN KEY (payment_chain_id) REFERENCES payment_chains(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS transfer_matches (
        id TEXT PRIMARY KEY,
        source_actual_transaction_id TEXT NOT NULL,
        target_actual_transaction_id TEXT NOT NULL,
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'proposed',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (source_actual_transaction_id <> target_actual_transaction_id)
      );

      CREATE TABLE IF NOT EXISTS clarification_cases (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        subject TEXT,
        payload_json TEXT NOT NULL,
        resolution_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prediction_entries (
        id TEXT PRIMARY KEY,
        contract_id TEXT,
        expected_date TEXT NOT NULL,
        expected_amount_minor INTEGER,
        currency TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        actual_transaction_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS merchant_mappings (
        id TEXT PRIMARY KEY,
        normalized_merchant TEXT NOT NULL,
        match_pattern TEXT NOT NULL,
        contract_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS recognition_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 100,
        condition_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_links_actual_transaction
        ON transaction_links(actual_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_links_contract
        ON transaction_links(contract_id);
      CREATE INDEX IF NOT EXISTS idx_payment_chains_contract
        ON payment_chains(contract_id);
      CREATE INDEX IF NOT EXISTS idx_clarification_cases_status
        ON clarification_cases(status);
      CREATE INDEX IF NOT EXISTS idx_prediction_entries_date
        ON prediction_entries(expected_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_matches_pair
        ON transfer_matches(source_actual_transaction_id, target_actual_transaction_id);
    `,
  },
  {
    version: 2,
    name: 'contract-management',
    sql: `
      ALTER TABLE contracts ADD COLUMN provider TEXT;
      ALTER TABLE contracts ADD COLUMN account_id TEXT;
      ALTER TABLE contracts ADD COLUMN payee_id TEXT;
      ALTER TABLE contracts ADD COLUMN amount_mode TEXT NOT NULL DEFAULT 'fixed';
      ALTER TABLE contracts ADD COLUMN next_payment_date TEXT;
      ALTER TABLE contracts ADD COLUMN minimum_term_months INTEGER;
      ALTER TABLE contracts ADD COLUMN cancellation_notice_days INTEGER;
      ALTER TABLE contracts ADD COLUMN cancellation_date TEXT;

      CREATE TABLE IF NOT EXISTS contract_price_history (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        actual_transaction_id TEXT,
        effective_date TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_status
        ON contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_account
        ON contracts(account_id);
      CREATE INDEX IF NOT EXISTS idx_contracts_payee
        ON contracts(payee_id);
      CREATE INDEX IF NOT EXISTS idx_contract_price_history_contract_date
        ON contract_price_history(contract_id, effective_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_links_contract_transaction_type
        ON transaction_links(contract_id, actual_transaction_id, link_type)
        WHERE contract_id IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: 'payment-chains-returns-splits',
    sql: `
      ALTER TABLE payment_chains ADD COLUMN title TEXT;
      ALTER TABLE payment_chains ADD COLUMN account_id TEXT;
      ALTER TABLE payment_chains ADD COLUMN settled_at TEXT;
      ALTER TABLE payment_chains ADD COLUMN failure_reason TEXT;

      ALTER TABLE transaction_links ADD COLUMN signed_amount_minor INTEGER;
      ALTER TABLE transaction_links ADD COLUMN occurred_on TEXT;

      ALTER TABLE clarification_cases ADD COLUMN payment_chain_id TEXT;
      ALTER TABLE clarification_cases ADD COLUMN actual_transaction_id TEXT;
      ALTER TABLE clarification_cases ADD COLUMN confidence REAL;

      CREATE TABLE IF NOT EXISTS transaction_splits (
        id TEXT PRIMARY KEY,
        payment_chain_id TEXT NOT NULL,
        transaction_link_id TEXT NOT NULL,
        actual_transaction_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (payment_chain_id) REFERENCES payment_chains(id) ON DELETE CASCADE,
        FOREIGN KEY (transaction_link_id) REFERENCES transaction_links(id) ON DELETE CASCADE,
        CHECK (amount_minor >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_links_chain_transaction
        ON transaction_links(payment_chain_id, actual_transaction_id)
        WHERE payment_chain_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_transaction_links_chain_date
        ON transaction_links(payment_chain_id, occurred_on);
      CREATE INDEX IF NOT EXISTS idx_transaction_splits_chain
        ON transaction_splits(payment_chain_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_splits_link
        ON transaction_splits(transaction_link_id);
      CREATE INDEX IF NOT EXISTS idx_clarification_cases_chain_status
        ON clarification_cases(payment_chain_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clarification_open_chain_transaction
        ON clarification_cases(payment_chain_id, actual_transaction_id, kind)
        WHERE payment_chain_id IS NOT NULL
          AND actual_transaction_id IS NOT NULL
          AND status = 'open';
    `,
  },

  {
    version: 4,
    name: 'transfers-and-credit-cards',
    sql: `
      ALTER TABLE transfer_matches ADD COLUMN source_account_id TEXT;
      ALTER TABLE transfer_matches ADD COLUMN target_account_id TEXT;
      ALTER TABLE transfer_matches ADD COLUMN amount_minor INTEGER;
      ALTER TABLE transfer_matches ADD COLUMN source_date TEXT;
      ALTER TABLE transfer_matches ADD COLUMN target_date TEXT;
      ALTER TABLE transfer_matches ADD COLUMN match_kind TEXT NOT NULL DEFAULT 'internal_transfer';
      ALTER TABLE transfer_matches ADD COLUMN confirmed_at TEXT;
      ALTER TABLE transfer_matches ADD COLUMN source TEXT;

      CREATE TABLE IF NOT EXISTS credit_card_accounts (
        actual_account_id TEXT PRIMARY KEY,
        funding_account_id TEXT,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (funding_account_id IS NULL OR funding_account_id <> actual_account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transfer_matches_source_account
        ON transfer_matches(source_account_id);
      CREATE INDEX IF NOT EXISTS idx_transfer_matches_target_account
        ON transfer_matches(target_account_id);
      CREATE INDEX IF NOT EXISTS idx_transfer_matches_status_kind
        ON transfer_matches(status, match_kind);
      CREATE INDEX IF NOT EXISTS idx_credit_card_accounts_funding
        ON credit_card_accounts(funding_account_id);
    `,
  },

  {
    version: 5,
    name: 'forecasts-and-clarifications',
    sql: `
      ALTER TABLE prediction_entries ADD COLUMN title TEXT;
      ALTER TABLE prediction_entries ADD COLUMN account_id TEXT;
      ALTER TABLE prediction_entries ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE prediction_entries ADD COLUMN source_ref TEXT;
      ALTER TABLE prediction_entries ADD COLUMN confidence REAL;
      ALTER TABLE prediction_entries ADD COLUMN notes TEXT;

      CREATE INDEX IF NOT EXISTS idx_prediction_entries_account_date
        ON prediction_entries(account_id, expected_date);
      CREATE INDEX IF NOT EXISTS idx_prediction_entries_status_date
        ON prediction_entries(status, expected_date);
      CREATE INDEX IF NOT EXISTS idx_prediction_entries_source
        ON prediction_entries(source_kind, source_ref);

      CREATE INDEX IF NOT EXISTS idx_clarification_cases_kind_status
        ON clarification_cases(kind, status);
    `,
  },

];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number }>
    ).map(row => row.version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
    });

    apply();
  }
}

export function getLatestMigrationVersion(): number {
  return migrations.at(-1)?.version ?? 0;
}
