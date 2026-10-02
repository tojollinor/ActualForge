import { randomUUID } from 'node:crypto';

import { ContractError } from './contracts.js';
import type { FinanceDatabase } from './db.js';
import {
  analyzeCreditCards,
  listTransferMatches,
  type TransferCandidate,
} from './transfers.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PredictionStatus = 'planned' | 'fulfilled' | 'cancelled';
export type PredictionSourceKind =
  | 'manual'
  | 'actual_schedule'
  | 'contract'
  | 'payment_chain'
  | 'credit_card_settlement';

export type PredictionInput = {
  title: string;
  accountId: string;
  expectedDate: string;
  amountMinor: number;
  currency?: string | null;
  notes?: string | null;
  status?: PredictionStatus;
};

export type ForecastAccountInput = {
  accountId: string;
  accountName?: string | null;
  balanceMinor: number;
};

export type ScheduleForecastInput = {
  sourceRef: string;
  accountId: string;
  accountName?: string | null;
  title: string;
  date: string;
  amountMinor: number;
  confidence?: number | null;
};

export type ForecastRequest = {
  startDate: string;
  endDate: string;
  accounts: ForecastAccountInput[];
  scheduleEvents?: ScheduleForecastInput[];
  transactionCandidates?: TransferCandidate[];
};

type PredictionRow = {
  id: string;
  contract_id: string | null;
  expected_date: string;
  expected_amount_minor: number | null;
  currency: string | null;
  status: PredictionStatus;
  actual_transaction_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
  account_id: string | null;
  source_kind: PredictionSourceKind;
  source_ref: string | null;
  confidence: number | null;
  notes: string | null;
};

type ForecastEntry = {
  id: string;
  title: string;
  accountId: string;
  accountName: string | null;
  date: string;
  amountMinor: number;
  currency: string;
  sourceKind: PredictionSourceKind;
  sourceRef: string | null;
  confidence: number;
  explanation: string;
  projectedBalanceMinor?: number;
};

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ContractError('invalid_text');
  const normalized = value.trim();
  return normalized || null;
}

function requiredText(value: unknown, code: string): string {
  const result = text(value);
  if (!result) throw new ContractError(code);
  return result;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new ContractError('invalid_date');
  }
  return value;
}

function integer(value: unknown): number {
  if (!Number.isInteger(value)) throw new ContractError('invalid_integer');
  return value as number;
}

function confidence(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function mapPrediction(row: PredictionRow) {
  return {
    id: row.id,
    contractId: row.contract_id,
    title: row.title ?? 'Geplante Zahlung',
    accountId: row.account_id,
    expectedDate: row.expected_date,
    amountMinor: row.expected_amount_minor ?? 0,
    currency: row.currency ?? 'EUR',
    status: row.status,
    actualTransactionId: row.actual_transaction_id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    notes: row.notes,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPredictions(
  db: FinanceDatabase,
  status?: PredictionStatus | null,
) {
  const rows = status
    ? (db
        .prepare(
          `SELECT * FROM prediction_entries
           WHERE status = ?
           ORDER BY expected_date, created_at`,
        )
        .all(status) as PredictionRow[])
    : (db
        .prepare(
          `SELECT * FROM prediction_entries
           ORDER BY
             CASE status WHEN 'planned' THEN 0 WHEN 'fulfilled' THEN 1 ELSE 2 END,
             expected_date,
             created_at`,
        )
        .all() as PredictionRow[]);
  return rows.map(mapPrediction);
}

export function createPrediction(
  db: FinanceDatabase,
  input: PredictionInput,
) {
  const title = requiredText(input.title, 'prediction_title_required');
  const accountId = requiredText(input.accountId, 'prediction_account_required');
  const expectedDate = date(input.expectedDate);
  const amountMinor = integer(input.amountMinor);
  if (amountMinor === 0) throw new ContractError('prediction_amount_required');
  const currency = text(input.currency) ?? 'EUR';
  const notes = text(input.notes);
  const status = input.status ?? 'planned';
  if (!['planned', 'fulfilled', 'cancelled'].includes(status)) {
    throw new ContractError('invalid_prediction_status');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prediction_entries (
      id, contract_id, expected_date, expected_amount_minor, currency, status,
      actual_transaction_id, metadata_json, created_at, updated_at,
      title, account_id, source_kind, source_ref, confidence, notes
    ) VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'manual', NULL, 1, ?)`,
  ).run(
    id,
    expectedDate,
    amountMinor,
    currency,
    status,
    now,
    now,
    title,
    accountId,
    notes,
  );

  return listPredictions(db).find(item => item.id === id)!;
}

export function updatePrediction(
  db: FinanceDatabase,
  id: string,
  input: Partial<PredictionInput>,
) {
  const existing = db
    .prepare('SELECT * FROM prediction_entries WHERE id = ?')
    .get(id) as PredictionRow | undefined;
  if (!existing) throw new ContractError('prediction_not_found', 404);
  if (existing.source_kind !== 'manual') {
    throw new ContractError('derived_prediction_read_only', 409);
  }

  const titleValue =
    input.title === undefined
      ? existing.title
      : requiredText(input.title, 'prediction_title_required');
  const accountId =
    input.accountId === undefined
      ? existing.account_id
      : requiredText(input.accountId, 'prediction_account_required');
  const expectedDate =
    input.expectedDate === undefined
      ? existing.expected_date
      : date(input.expectedDate);
  const amountMinor =
    input.amountMinor === undefined
      ? existing.expected_amount_minor
      : integer(input.amountMinor);
  if (!amountMinor) throw new ContractError('prediction_amount_required');
  const currency =
    input.currency === undefined
      ? existing.currency
      : text(input.currency) ?? 'EUR';
  const notes =
    input.notes === undefined ? existing.notes : text(input.notes);
  const status = input.status ?? existing.status;
  if (!['planned', 'fulfilled', 'cancelled'].includes(status)) {
    throw new ContractError('invalid_prediction_status');
  }

  db.prepare(
    `UPDATE prediction_entries
     SET title = ?, account_id = ?, expected_date = ?, expected_amount_minor = ?,
         currency = ?, notes = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    titleValue,
    accountId,
    expectedDate,
    amountMinor,
    currency,
    notes,
    status,
    new Date().toISOString(),
    id,
  );

  return listPredictions(db).find(item => item.id === id)!;
}

export function removePrediction(db: FinanceDatabase, id: string) {
  const result = db
    .prepare(
      `DELETE FROM prediction_entries
       WHERE id = ? AND source_kind = 'manual'`,
    )
    .run(id);
  if (result.changes === 0) {
    throw new ContractError('prediction_not_found', 404);
  }
}

function dateValue(value: string): Date {
  return new Date(value + 'T12:00:00Z');
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, count: number): string {
  const result = dateValue(value);
  result.setUTCDate(result.getUTCDate() + count);
  return isoDay(result);
}

function addMonths(value: string, count: number): string {
  const source = dateValue(value);
  const day = source.getUTCDate();
  const result = new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth() + count,
      1,
      12,
    ),
  );
  const maxDay = new Date(
    Date.UTC(
      result.getUTCFullYear(),
      result.getUTCMonth() + 1,
      0,
      12,
    ),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, maxDay));
  return isoDay(result);
}

function nextRecurrence(value: string, recurrence: string | null): string | null {
  switch (recurrence) {
    case 'weekly':
      return addDays(value, 7);
    case 'monthly':
      return addMonths(value, 1);
    case 'quarterly':
      return addMonths(value, 3);
    case 'semiannual':
      return addMonths(value, 6);
    case 'annual':
      return addMonths(value, 12);
    default:
      return null;
  }
}

function inRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function closeDate(left: string, right: string, toleranceDays = 3) {
  const difference = Math.abs(
    dateValue(left).getTime() - dateValue(right).getTime(),
  );
  return difference <= toleranceDays * 86_400_000;
}

function closeAmount(left: number, right: number) {
  const expected = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(Math.abs(left) - Math.abs(right)) <= Math.max(100, expected * 0.03);
}

function matchesDerived(
  entry: ForecastEntry,
  candidate: ForecastEntry,
  dateTolerance = 3,
) {
  return (
    entry.accountId === candidate.accountId &&
    Math.sign(entry.amountMinor) === Math.sign(candidate.amountMinor) &&
    closeAmount(entry.amountMinor, candidate.amountMinor) &&
    closeDate(entry.date, candidate.date, dateTolerance)
  );
}

function buildScheduleEntries(
  request: ForecastRequest,
  accountNames: Map<string, string | null>,
): ForecastEntry[] {
  return (request.scheduleEvents ?? [])
    .filter(
      item =>
        item &&
        typeof item.sourceRef === 'string' &&
        typeof item.accountId === 'string' &&
        typeof item.title === 'string' &&
        DATE.test(item.date) &&
        Number.isInteger(item.amountMinor) &&
        item.amountMinor !== 0 &&
        inRange(item.date, request.startDate, request.endDate),
    )
    .map(item => ({
      id: `actual-schedule:${item.sourceRef}`,
      title: item.title,
      accountId: item.accountId,
      accountName:
        item.accountName ?? accountNames.get(item.accountId) ?? null,
      date: item.date,
      amountMinor: item.amountMinor,
      currency: 'EUR',
      sourceKind: 'actual_schedule' as const,
      sourceRef: item.sourceRef,
      confidence: confidence(item.confidence, 1),
      explanation: 'Actual-Schedule',
    }));
}

function buildPaymentChainEntries(
  db: FinanceDatabase,
  request: ForecastRequest,
  accountNames: Map<string, string | null>,
): Array<ForecastEntry & { contractId: string | null }> {
  const rows = db
    .prepare(
      `SELECT id, contract_id, title, account_id, status,
              expected_amount_minor, currency, due_date
       FROM payment_chains
       WHERE status IN ('open', 'reversed', 'needs_clarification')
         AND due_date IS NOT NULL
         AND due_date >= ?
         AND due_date <= ?
       ORDER BY due_date`,
    )
    .all(request.startDate, request.endDate) as Array<{
    id: string;
    contract_id: string | null;
    title: string | null;
    account_id: string | null;
    status: string;
    expected_amount_minor: number | null;
    currency: string | null;
    due_date: string;
  }>;

  return rows
    .filter(
      row =>
        row.account_id &&
        row.expected_amount_minor != null &&
        row.expected_amount_minor > 0,
    )
    .map(row => ({
      id: `payment-chain:${row.id}`,
      title: row.title ?? 'Geplante Zahlung',
      accountId: row.account_id!,
      accountName: accountNames.get(row.account_id!) ?? null,
      date: row.due_date,
      amountMinor: -Math.abs(row.expected_amount_minor!),
      currency: row.currency ?? 'EUR',
      sourceKind: 'payment_chain' as const,
      sourceRef: row.id,
      confidence: row.status === 'needs_clarification' ? 0.65 : 0.9,
      explanation:
        row.status === 'reversed'
          ? 'Erwartete erneute Zahlung nach Rückbuchung'
          : 'Offene Zahlungskette',
      contractId: row.contract_id,
    }));
}

function buildContractEntries(
  db: FinanceDatabase,
  request: ForecastRequest,
  accountNames: Map<string, string | null>,
  paymentChains: Array<ForecastEntry & { contractId: string | null }>,
  schedules: ForecastEntry[],
): ForecastEntry[] {
  const rows = db
    .prepare(
      `SELECT id, title, account_id, amount_minor, amount_mode, currency,
              recurrence, next_payment_date, end_date, cancellation_date
       FROM contracts
       WHERE status = 'active'
         AND account_id IS NOT NULL
         AND amount_minor IS NOT NULL
         AND amount_minor > 0
         AND next_payment_date IS NOT NULL
       ORDER BY next_payment_date`,
    )
    .all() as Array<{
    id: string;
    title: string;
    account_id: string;
    amount_minor: number;
    amount_mode: string;
    currency: string | null;
    recurrence: string | null;
    next_payment_date: string;
    end_date: string | null;
    cancellation_date: string | null;
  }>;

  const result: ForecastEntry[] = [];

  for (const row of rows) {
    let occurrence: string | null = row.next_payment_date;
    let guard = 0;

    while (occurrence && occurrence <= request.endDate && guard < 400) {
      guard += 1;
      const contractEnd = [row.end_date, row.cancellation_date]
        .filter((value): value is string => Boolean(value))
        .sort()[0];

      if (contractEnd && occurrence > contractEnd) break;

      if (occurrence >= request.startDate) {
        const entry: ForecastEntry = {
          id: `contract:${row.id}:${occurrence}`,
          title: row.title,
          accountId: row.account_id,
          accountName: accountNames.get(row.account_id) ?? null,
          date: occurrence,
          amountMinor: -Math.abs(row.amount_minor),
          currency: row.currency ?? 'EUR',
          sourceKind: 'contract',
          sourceRef: row.id,
          confidence: row.amount_mode === 'variable' ? 0.65 : 0.9,
          explanation:
            row.amount_mode === 'variable'
              ? 'Vertrag mit variablem Betrag'
              : 'Vertrag',
        };

        const coveredByChain = paymentChains.some(
          chain =>
            chain.contractId === row.id &&
            matchesDerived(entry, chain, 7),
        );
        const coveredBySchedule = schedules.some(schedule =>
          matchesDerived(entry, schedule, 3),
        );

        if (!coveredByChain && !coveredBySchedule) {
          result.push(entry);
        }
      }

      occurrence = nextRecurrence(occurrence, row.recurrence);
    }
  }

  return result;
}

function buildManualEntries(
  db: FinanceDatabase,
  request: ForecastRequest,
  accountNames: Map<string, string | null>,
): ForecastEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM prediction_entries
       WHERE status = 'planned'
         AND source_kind = 'manual'
         AND expected_date >= ?
         AND expected_date <= ?
       ORDER BY expected_date`,
    )
    .all(request.startDate, request.endDate) as PredictionRow[];

  return rows
    .filter(row => row.account_id && row.expected_amount_minor)
    .map(row => ({
      id: `prediction:${row.id}`,
      title: row.title ?? 'Geplante Zahlung',
      accountId: row.account_id!,
      accountName: accountNames.get(row.account_id!) ?? null,
      date: row.expected_date,
      amountMinor: row.expected_amount_minor!,
      currency: row.currency ?? 'EUR',
      sourceKind: 'manual',
      sourceRef: row.id,
      confidence: confidence(row.confidence, 1),
      explanation: 'Manuell geplante Zahlung',
    }));
}

function buildCreditCardEntries(
  db: FinanceDatabase,
  request: ForecastRequest,
  accountNames: Map<string, string | null>,
  schedules: ForecastEntry[],
): ForecastEntry[] {
  const candidates = request.transactionCandidates ?? [];
  if (candidates.length === 0) return [];

  const analyses = analyzeCreditCards(db, candidates);
  const matches = listTransferMatches(db)
    .filter(
      match =>
        match.status === 'confirmed' &&
        match.kind === 'credit_card_payment' &&
        Boolean(match.targetDate ?? match.sourceDate),
    )
    .sort((left, right) =>
      (right.targetDate ?? right.sourceDate ?? '').localeCompare(
        left.targetDate ?? left.sourceDate ?? '',
      ),
    );

  const result: ForecastEntry[] = [];

  for (const analysis of analyses) {
    if (!analysis.fundingAccountId) continue;
    const openCycle = analysis.cycles.find(cycle => cycle.status === 'open');
    if (!openCycle || openCycle.netExpenseMinor <= 0) continue;

    const latestPayment = matches.find(
      match => match.targetAccountId === analysis.actualAccountId,
    );
    const latestDate = latestPayment?.targetDate ?? latestPayment?.sourceDate;
    if (!latestDate) continue;

    const settlementDate = addMonths(latestDate, 1);
    if (!inRange(settlementDate, request.startDate, request.endDate)) continue;

    const amount = openCycle.netExpenseMinor;
    const funding: ForecastEntry = {
      id: `credit-card:${analysis.actualAccountId}:${settlementDate}:funding`,
      title: `${analysis.label ?? 'Kreditkarte'} Abrechnung`,
      accountId: analysis.fundingAccountId,
      accountName: accountNames.get(analysis.fundingAccountId) ?? null,
      date: settlementDate,
      amountMinor: -amount,
      currency: 'EUR',
      sourceKind: 'credit_card_settlement',
      sourceRef: analysis.actualAccountId,
      confidence: 0.72,
      explanation: 'Hochgerechnete Kreditkartenabrechnung aus offenem Zyklus',
    };
    const card: ForecastEntry = {
      ...funding,
      id: `credit-card:${analysis.actualAccountId}:${settlementDate}:card`,
      accountId: analysis.actualAccountId,
      accountName: accountNames.get(analysis.actualAccountId) ?? null,
      amountMinor: amount,
    };

    const coveredBySchedule = schedules.some(schedule =>
      matchesDerived(funding, schedule, 4),
    );
    if (!coveredBySchedule) {
      result.push(funding, card);
    }
  }

  return result;
}

export function generateForecast(
  db: FinanceDatabase,
  request: ForecastRequest,
) {
  const startDate = date(request.startDate);
  const endDate = date(request.endDate);
  if (endDate < startDate) throw new ContractError('invalid_forecast_range');
  if (!Array.isArray(request.accounts)) {
    throw new ContractError('invalid_forecast_accounts');
  }

  const accounts = request.accounts
    .filter(
      account =>
        account &&
        typeof account.accountId === 'string' &&
        Number.isInteger(account.balanceMinor),
    )
    .map(account => ({
      accountId: account.accountId,
      accountName: text(account.accountName),
      balanceMinor: account.balanceMinor,
    }));
  const accountNames = new Map(
    accounts.map(account => [account.accountId, account.accountName]),
  );

  const schedules = buildScheduleEntries(request, accountNames);
  const paymentChains = buildPaymentChainEntries(db, request, accountNames);
  const contracts = buildContractEntries(
    db,
    request,
    accountNames,
    paymentChains,
    schedules,
  );
  const manual = buildManualEntries(db, request, accountNames);
  const creditCards = buildCreditCardEntries(
    db,
    request,
    accountNames,
    schedules,
  );

  const entries = [
    ...schedules,
    ...paymentChains,
    ...contracts,
    ...manual,
    ...creditCards,
  ].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.accountId.localeCompare(right.accountId) ||
      left.id.localeCompare(right.id),
  );

  const balances = new Map(
    accounts.map(account => [account.accountId, account.balanceMinor]),
  );
  for (const entry of entries) {
    if (!balances.has(entry.accountId)) continue;
    const next = (balances.get(entry.accountId) ?? 0) + entry.amountMinor;
    balances.set(entry.accountId, next);
    entry.projectedBalanceMinor = next;
  }

  const accountSummaries = accounts.map(account => {
    const accountEntries = entries.filter(
      entry => entry.accountId === account.accountId,
    );
    let running = account.balanceMinor;
    let lowestBalanceMinor = running;
    let lowestBalanceDate = startDate;

    for (const entry of accountEntries) {
      running += entry.amountMinor;
      if (running < lowestBalanceMinor) {
        lowestBalanceMinor = running;
        lowestBalanceDate = entry.date;
      }
    }

    return {
      accountId: account.accountId,
      accountName: account.accountName,
      startBalanceMinor: account.balanceMinor,
      endBalanceMinor: running,
      lowestBalanceMinor,
      lowestBalanceDate,
      eventCount: accountEntries.length,
    };
  });

  const totalStartBalanceMinor = accountSummaries.reduce(
    (sum, account) => sum + account.startBalanceMinor,
    0,
  );
  const totalEndBalanceMinor = accountSummaries.reduce(
    (sum, account) => sum + account.endBalanceMinor,
    0,
  );

  return {
    startDate,
    endDate,
    entries,
    accounts: accountSummaries,
    summary: {
      totalStartBalanceMinor,
      totalEndBalanceMinor,
      netChangeMinor: totalEndBalanceMinor - totalStartBalanceMinor,
      incomeMinor: entries
        .filter(entry => entry.amountMinor > 0)
        .reduce((sum, entry) => sum + entry.amountMinor, 0),
      expenseMinor: entries
        .filter(entry => entry.amountMinor < 0)
        .reduce((sum, entry) => sum + Math.abs(entry.amountMinor), 0),
      eventCount: entries.length,
    },
  };
}
