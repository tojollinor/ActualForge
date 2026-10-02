import { randomUUID } from 'node:crypto';

import type { FinanceDatabase } from './db.js';

export type ContractStatus = 'active' | 'paused' | 'cancelled' | 'archived';
export type ContractAmountMode = 'fixed' | 'variable';

export type ContractInput = {
  title: string;
  provider?: string | null;
  kind?: string | null;
  status?: ContractStatus;
  accountId?: string | null;
  payeeId?: string | null;
  amountMinor?: number | null;
  amountMode?: ContractAmountMode;
  currency?: string | null;
  recurrence?: string | null;
  nextPaymentDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  minimumTermMonths?: number | null;
  cancellationNoticeDays?: number | null;
  cancellationDate?: string | null;
  notes?: string | null;
};

export type Contract = ContractInput & {
  id: string;
  status: ContractStatus;
  amountMode: ContractAmountMode;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  linkedTransactionCount: number;
  proposedTransactionCount: number;
};

export type TransactionCandidate = {
  actualTransactionId: string;
  date: string;
  amountMinor: number;
  accountId: string;
  payeeId?: string | null;
  payeeName?: string | null;
  notes?: string | null;
};

export class ContractError extends Error {
  constructor(
    public code: string,
    public statusCode = 400,
  ) {
    super(code);
  }
}

type ContractRow = {
  id: string;
  title: string;
  provider: string | null;
  kind: string | null;
  status: ContractStatus;
  account_id: string | null;
  payee_id: string | null;
  amount_minor: number | null;
  amount_mode: ContractAmountMode;
  currency: string | null;
  recurrence: string | null;
  next_payment_date: string | null;
  start_date: string | null;
  end_date: string | null;
  minimum_term_months: number | null;
  cancellation_notice_days: number | null;
  cancellation_date: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  linked_transaction_count?: number;
  proposed_transaction_count?: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<ContractStatus>([
  'active',
  'paused',
  'cancelled',
  'archived',
]);
const AMOUNT_MODES = new Set<ContractAmountMode>(['fixed', 'variable']);

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ContractError('invalid_text');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function optionalDate(value: unknown): string | null {
  const text = optionalText(value);
  if (text != null && !DATE_PATTERN.test(text)) {
    throw new ContractError('invalid_date');
  }
  return text;
}

function optionalInteger(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value)) throw new ContractError('invalid_integer');
  return value as number;
}

function normalizeInput(
  input: Partial<ContractInput>,
  requireTitle: boolean,
): Partial<ContractInput> {
  const normalized: Partial<ContractInput> = {};

  if (requireTitle || input.title !== undefined) {
    const title = optionalText(input.title);
    if (!title) throw new ContractError('title_required');
    normalized.title = title;
  }

  for (const key of ['provider', 'kind', 'accountId', 'payeeId', 'currency', 'recurrence', 'notes'] as const) {
    if (input[key] !== undefined) {
      normalized[key] = optionalText(input[key]);
    }
  }

  for (const key of ['nextPaymentDate', 'startDate', 'endDate', 'cancellationDate'] as const) {
    if (input[key] !== undefined) {
      normalized[key] = optionalDate(input[key]);
    }
  }

  for (const key of ['minimumTermMonths', 'cancellationNoticeDays'] as const) {
    if (input[key] !== undefined) {
      const value = optionalInteger(input[key]);
      if (value != null && value < 0) throw new ContractError('invalid_integer');
      normalized[key] = value;
    }
  }

  if (input.amountMinor !== undefined) {
    const value = optionalInteger(input.amountMinor);
    normalized.amountMinor = value == null ? null : Math.abs(value);
  }

  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new ContractError('invalid_status');
    normalized.status = input.status;
  }

  if (input.amountMode !== undefined) {
    if (!AMOUNT_MODES.has(input.amountMode)) {
      throw new ContractError('invalid_amount_mode');
    }
    normalized.amountMode = input.amountMode;
  }

  return normalized;
}

function mapContract(row: ContractRow): Contract {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    kind: row.kind,
    status: row.status,
    accountId: row.account_id,
    payeeId: row.payee_id,
    amountMinor: row.amount_minor,
    amountMode: row.amount_mode,
    currency: row.currency,
    recurrence: row.recurrence,
    nextPaymentDate: row.next_payment_date,
    startDate: row.start_date,
    endDate: row.end_date,
    minimumTermMonths: row.minimum_term_months,
    cancellationNoticeDays: row.cancellation_notice_days,
    cancellationDate: row.cancellation_date,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkedTransactionCount: row.linked_transaction_count ?? 0,
    proposedTransactionCount: row.proposed_transaction_count ?? 0,
  };
}

const contractSelect = `
  SELECT
    c.*,
    (
      SELECT COUNT(*)
      FROM transaction_links tl
      WHERE tl.contract_id = c.id AND tl.status = 'confirmed'
    ) AS linked_transaction_count,
    (
      SELECT COUNT(*)
      FROM transaction_links tl
      WHERE tl.contract_id = c.id AND tl.status = 'proposed'
    ) AS proposed_transaction_count
  FROM contracts c
`;

export function listContracts(db: FinanceDatabase): Contract[] {
  return (
    db
      .prepare(
        contractSelect +
          ` ORDER BY
              CASE c.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
              COALESCE(c.provider, c.title) COLLATE NOCASE,
              c.title COLLATE NOCASE`,
      )
      .all() as ContractRow[]
  ).map(mapContract);
}

export function getContract(db: FinanceDatabase, id: string): Contract {
  const row = db
    .prepare(contractSelect + ' WHERE c.id = ?')
    .get(id) as ContractRow | undefined;

  if (!row) throw new ContractError('contract_not_found', 404);
  return mapContract(row);
}

export function createContract(
  db: FinanceDatabase,
  input: ContractInput,
): Contract {
  const value = normalizeInput(input, true) as ContractInput;
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO contracts (
      id, title, provider, kind, status, account_id, payee_id,
      amount_minor, amount_mode, currency, recurrence, next_payment_date,
      start_date, end_date, minimum_term_months, cancellation_notice_days,
      cancellation_date, source, notes, created_at, updated_at
    ) VALUES (
      @id, @title, @provider, @kind, @status, @accountId, @payeeId,
      @amountMinor, @amountMode, @currency, @recurrence, @nextPaymentDate,
      @startDate, @endDate, @minimumTermMonths, @cancellationNoticeDays,
      @cancellationDate, 'manual', @notes, @createdAt, @updatedAt
    )`,
  ).run({
    id,
    title: value.title,
    provider: value.provider ?? null,
    kind: value.kind ?? null,
    status: value.status ?? 'active',
    accountId: value.accountId ?? null,
    payeeId: value.payeeId ?? null,
    amountMinor: value.amountMinor ?? null,
    amountMode: value.amountMode ?? 'fixed',
    currency: value.currency ?? 'EUR',
    recurrence: value.recurrence ?? null,
    nextPaymentDate: value.nextPaymentDate ?? null,
    startDate: value.startDate ?? null,
    endDate: value.endDate ?? null,
    minimumTermMonths: value.minimumTermMonths ?? null,
    cancellationNoticeDays: value.cancellationNoticeDays ?? null,
    cancellationDate: value.cancellationDate ?? null,
    notes: value.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return getContract(db, id);
}

const columnMap: Record<keyof ContractInput, string> = {
  title: 'title',
  provider: 'provider',
  kind: 'kind',
  status: 'status',
  accountId: 'account_id',
  payeeId: 'payee_id',
  amountMinor: 'amount_minor',
  amountMode: 'amount_mode',
  currency: 'currency',
  recurrence: 'recurrence',
  nextPaymentDate: 'next_payment_date',
  startDate: 'start_date',
  endDate: 'end_date',
  minimumTermMonths: 'minimum_term_months',
  cancellationNoticeDays: 'cancellation_notice_days',
  cancellationDate: 'cancellation_date',
  notes: 'notes',
};

export function updateContract(
  db: FinanceDatabase,
  id: string,
  input: Partial<ContractInput>,
): Contract {
  getContract(db, id);
  const value = normalizeInput(input, false);
  const entries = Object.entries(value) as Array<
    [keyof ContractInput, ContractInput[keyof ContractInput]]
  >;

  if (entries.length === 0) return getContract(db, id);

  const params: Record<string, unknown> = {
    id,
    updatedAt: new Date().toISOString(),
  };
  const assignments = entries.map(([key, fieldValue], index) => {
    const param = `value${index}`;
    params[param] = fieldValue ?? null;
    return `${columnMap[key]} = @${param}`;
  });

  assignments.push('updated_at = @updatedAt');
  db.prepare(
    `UPDATE contracts SET ${assignments.join(', ')} WHERE id = @id`,
  ).run(params);

  return getContract(db, id);
}

export type TransactionLink = {
  id: string;
  actualTransactionId: string;
  linkType: string;
  amountMinor: number | null;
  confidence: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listContractLinks(
  db: FinanceDatabase,
  contractId: string,
): TransactionLink[] {
  getContract(db, contractId);
  const rows = db
    .prepare(
      `SELECT id, actual_transaction_id, link_type, amount_minor, confidence,
              status, metadata_json, created_at, updated_at
       FROM transaction_links
       WHERE contract_id = ?
       ORDER BY created_at DESC`,
    )
    .all(contractId) as Array<{
    id: string;
    actual_transaction_id: string;
    link_type: string;
    amount_minor: number | null;
    confidence: number | null;
    status: string;
    metadata_json: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    actualTransactionId: row.actual_transaction_id,
    linkType: row.link_type,
    amountMinor: row.amount_minor,
    confidence: row.confidence,
    status: row.status,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export type PriceHistoryEntry = {
  id: string;
  actualTransactionId: string | null;
  effectiveDate: string;
  amountMinor: number;
  currency: string | null;
  source: string;
  createdAt: string;
};

export function listPriceHistory(
  db: FinanceDatabase,
  contractId: string,
): PriceHistoryEntry[] {
  getContract(db, contractId);
  const rows = db
    .prepare(
      `SELECT id, actual_transaction_id, effective_date, amount_minor,
              currency, source, created_at
       FROM contract_price_history
       WHERE contract_id = ?
       ORDER BY effective_date DESC, created_at DESC`,
    )
    .all(contractId) as Array<{
    id: string;
    actual_transaction_id: string | null;
    effective_date: string;
    amount_minor: number;
    currency: string | null;
    source: string;
    created_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    actualTransactionId: row.actual_transaction_id,
    effectiveDate: row.effective_date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    source: row.source,
    createdAt: row.created_at,
  }));
}

function recordObservedPrice(
  db: FinanceDatabase,
  contract: Contract,
  actualTransactionId: string,
  date: string,
  amountMinor: number,
): void {
  const amount = Math.abs(amountMinor);
  const latest = db
    .prepare(
      `SELECT amount_minor
       FROM contract_price_history
       WHERE contract_id = ?
       ORDER BY effective_date DESC, created_at DESC
       LIMIT 1`,
    )
    .get(contract.id) as { amount_minor: number } | undefined;

  if (latest?.amount_minor === amount) return;

  db.prepare(
    `INSERT INTO contract_price_history (
      id, contract_id, actual_transaction_id, effective_date,
      amount_minor, currency, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'transaction-link', ?)`,
  ).run(
    randomUUID(),
    contract.id,
    actualTransactionId,
    date,
    amount,
    contract.currency ?? 'EUR',
    new Date().toISOString(),
  );
}

export function confirmTransactionLink(
  db: FinanceDatabase,
  contractId: string,
  input: {
    actualTransactionId: string;
    amountMinor?: number | null;
    date?: string | null;
    linkType?: string;
    confidence?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): TransactionLink {
  const contract = getContract(db, contractId);
  const transactionId = optionalText(input.actualTransactionId);
  if (!transactionId) throw new ContractError('transaction_id_required');

  const linkType = optionalText(input.linkType) ?? 'payment';
  const amountMinor =
    input.amountMinor == null ? null : Math.abs(optionalInteger(input.amountMinor) ?? 0);
  const date = input.date == null ? null : optionalDate(input.date);
  const now = new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT id FROM transaction_links
       WHERE contract_id = ? AND actual_transaction_id = ? AND link_type = ?`,
    )
    .get(contractId, transactionId, linkType) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  if (existing) {
    db.prepare(
      `UPDATE transaction_links
       SET amount_minor = ?, occurred_on = ?, confidence = ?, status = 'confirmed',
           metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(amountMinor, date, input.confidence ?? 1, metadataJson, now, id);
  } else {
    db.prepare(
      `INSERT INTO transaction_links (
        id, actual_transaction_id, contract_id, payment_chain_id,
        link_type, amount_minor, occurred_on, confidence, status, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
    ).run(
      id,
      transactionId,
      contractId,
      linkType,
      amountMinor,
      date,
      input.confidence ?? 1,
      metadataJson,
      now,
      now,
    );
  }

  if (amountMinor != null && date) {
    recordObservedPrice(db, contract, transactionId, date, amountMinor);
  }

  return listContractLinks(db, contractId).find(link => link.id === id)!;
}

export function removeTransactionLink(
  db: FinanceDatabase,
  contractId: string,
  linkId: string,
): void {
  getContract(db, contractId);
  const result = db
    .prepare('DELETE FROM transaction_links WHERE id = ? AND contract_id = ?')
    .run(linkId, contractId);
  if (result.changes === 0) throw new ContractError('link_not_found', 404);
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
}

function daysBetween(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_VALUE;
  return Math.abs(left - right) / 86_400_000;
}

export type ContractSuggestion = {
  actualTransactionId: string;
  score: number;
  reasons: string[];
  amountChange: boolean;
  proposedLinkId: string | null;
};

export function suggestContractLinks(
  db: FinanceDatabase,
  contractId: string,
  candidates: TransactionCandidate[],
): ContractSuggestion[] {
  const contract = getContract(db, contractId);
  if (!Array.isArray(candidates)) throw new ContractError('invalid_candidates');

  const existing = new Map(
    listContractLinks(db, contractId).map(link => [
      link.actualTransactionId,
      link,
    ]),
  );
  const providerNeedle = normalizeMatchText(contract.provider);
  const results: ContractSuggestion[] = [];

  for (const candidate of candidates.slice(0, 500)) {
    if (
      !candidate ||
      typeof candidate.actualTransactionId !== 'string' ||
      typeof candidate.date !== 'string' ||
      !Number.isInteger(candidate.amountMinor) ||
      typeof candidate.accountId !== 'string'
    ) {
      continue;
    }

    if (existing.get(candidate.actualTransactionId)?.status === 'confirmed') {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const haystack = normalizeMatchText(
      [candidate.payeeName, candidate.notes].filter(Boolean).join(' '),
    );

    if (contract.payeeId && candidate.payeeId === contract.payeeId) {
      score += 0.4;
      reasons.push('payee');
    } else if (
      providerNeedle.length >= 3 &&
      haystack.includes(providerNeedle)
    ) {
      score += 0.4;
      reasons.push('provider');
    }

    if (contract.accountId && candidate.accountId === contract.accountId) {
      score += 0.15;
      reasons.push('account');
    }

    let amountChange = false;
    if (contract.amountMinor != null && contract.amountMinor > 0) {
      const expected = Math.abs(contract.amountMinor);
      const actual = Math.abs(candidate.amountMinor);
      const diff = Math.abs(actual - expected);
      const ratio = diff / expected;
      amountChange = ratio > 0.05;

      if (contract.amountMode === 'fixed') {
        if (diff <= Math.max(100, expected * 0.03)) {
          score += 0.3;
          reasons.push('amount');
        } else if (ratio <= 0.2) {
          score += 0.12;
          reasons.push('amount-near');
        }
      } else if (ratio <= 0.35) {
        score += 0.22;
        reasons.push('amount-variable');
      }
    }

    if (
      contract.nextPaymentDate &&
      daysBetween(contract.nextPaymentDate, candidate.date) <= 7
    ) {
      score += 0.15;
      reasons.push('date');
    }

    score = Math.min(1, Math.round(score * 100) / 100);
    if (score < 0.4) continue;

    let proposedLinkId = existing.get(candidate.actualTransactionId)?.id ?? null;

    if (score >= 0.6 && !proposedLinkId) {
      const now = new Date().toISOString();
      proposedLinkId = randomUUID();
      db.prepare(
        `INSERT INTO transaction_links (
          id, actual_transaction_id, contract_id, payment_chain_id,
          link_type, amount_minor, confidence, status, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'payment', ?, ?, 'proposed', ?, ?, ?)`,
      ).run(
        proposedLinkId,
        candidate.actualTransactionId,
        contractId,
        Math.abs(candidate.amountMinor),
        score,
        JSON.stringify({ reasons, amountChange, date: candidate.date }),
        now,
        now,
      );
    }

    results.push({
      actualTransactionId: candidate.actualTransactionId,
      score,
      reasons,
      amountChange,
      proposedLinkId,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 25);
}

export function getContractDetail(db: FinanceDatabase, contractId: string) {
  return {
    contract: getContract(db, contractId),
    links: listContractLinks(db, contractId),
    priceHistory: listPriceHistory(db, contractId),
  };
}
