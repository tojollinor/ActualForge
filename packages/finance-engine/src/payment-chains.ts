import { randomUUID } from 'node:crypto';

import {
  ContractError,
  getContract,
  type TransactionCandidate,
} from './contracts.js';
import type { FinanceDatabase } from './db.js';

export type PaymentChainStatus =
  | 'open'
  | 'reversed'
  | 'settled'
  | 'failed'
  | 'needs_clarification';
export type PaymentRole =
  | 'payment_attempt'
  | 'reversal'
  | 'settlement'
  | 'fee'
  | 'failed';
export type SplitKind =
  | 'contract_amount'
  | 'return_fee'
  | 'bank_fee'
  | 'dunning_fee'
  | 'other_fee';

export type PaymentChainInput = {
  contractId?: string | null;
  title?: string | null;
  accountId?: string | null;
  expectedAmountMinor?: number | null;
  currency?: string | null;
  dueDate?: string | null;
};

export type TransactionSplitInput = {
  kind: SplitKind;
  amountMinor: number;
  notes?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = new Set<PaymentRole>([
  'payment_attempt',
  'reversal',
  'settlement',
  'fee',
  'failed',
]);
const SPLITS = new Set<SplitKind>([
  'contract_amount',
  'return_fee',
  'bank_fee',
  'dunning_fee',
  'other_fee',
]);

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ContractError('invalid_text');
  const trimmed = value.trim();
  return trimmed || null;
}

function date(value: unknown): string | null {
  const valueText = text(value);
  if (valueText && !DATE.test(valueText)) throw new ContractError('invalid_date');
  return valueText;
}

function integer(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value)) throw new ContractError('invalid_integer');
  return value as number;
}

function json(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function days(a: string, b: string): number {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) /
    86400000;
}

const chainSelect = `
  SELECT pc.*, c.title AS contract_title,
    (SELECT COUNT(*) FROM transaction_links tl
      WHERE tl.payment_chain_id = pc.id AND tl.status = 'confirmed') AS link_count,
    (SELECT COUNT(*) FROM clarification_cases cc
      WHERE cc.payment_chain_id = pc.id AND cc.status = 'open') AS open_case_count
  FROM payment_chains pc
  LEFT JOIN contracts c ON c.id = pc.contract_id
`;

function mapChain(row: any) {
  return {
    id: row.id,
    contractId: row.contract_id,
    contractTitle: row.contract_title,
    title: row.title,
    accountId: row.account_id,
    status: row.status as PaymentChainStatus,
    expectedAmountMinor: row.expected_amount_minor,
    currency: row.currency,
    dueDate: row.due_date,
    settledAt: row.settled_at,
    failureReason: row.failure_reason,
    metadata: json(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    linkCount: row.link_count ?? 0,
    openClarificationCount: row.open_case_count ?? 0,
  };
}

export function listPaymentChains(
  db: FinanceDatabase,
  contractId?: string | null,
) {
  const sql =
    chainSelect +
    (contractId ? ' WHERE pc.contract_id = @contractId' : '') +
    ` ORDER BY
       CASE pc.status WHEN 'needs_clarification' THEN 0 WHEN 'reversed' THEN 1
         WHEN 'open' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,
       COALESCE(pc.due_date, pc.created_at) DESC`;
  const rows = contractId
    ? db.prepare(sql).all({ contractId })
    : db.prepare(sql).all();
  return (rows as any[]).map(mapChain);
}

export function getPaymentChain(db: FinanceDatabase, id: string) {
  const row = db.prepare(chainSelect + ' WHERE pc.id = ?').get(id) as any;
  if (!row) throw new ContractError('payment_chain_not_found', 404);
  return mapChain(row);
}

export function createPaymentChain(
  db: FinanceDatabase,
  input: PaymentChainInput,
) {
  const contractId = text(input.contractId);
  const contract = contractId ? getContract(db, contractId) : null;
  const explicitAmount = integer(input.expectedAmountMinor);
  const expectedAmountMinor =
    explicitAmount == null ? contract?.amountMinor ?? null : Math.abs(explicitAmount);
  const dueDate =
    input.dueDate === undefined ? contract?.nextPaymentDate ?? null : date(input.dueDate);
  const accountId =
    input.accountId === undefined ? contract?.accountId ?? null : text(input.accountId);
  const currency =
    input.currency === undefined
      ? contract?.currency ?? 'EUR'
      : text(input.currency) ?? 'EUR';
  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO payment_chains (
      id, contract_id, title, account_id, status, expected_amount_minor,
      currency, due_date, settled_at, failure_reason, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    contractId,
    text(input.title),
    accountId,
    expectedAmountMinor,
    currency,
    dueDate,
    now,
    now,
  );
  return getPaymentChain(db, id);
}

function listSplits(db: FinanceDatabase, chainId: string) {
  return (db
    .prepare(
      `SELECT id, payment_chain_id, transaction_link_id, actual_transaction_id,
              kind, amount_minor, notes, created_at, updated_at
       FROM transaction_splits WHERE payment_chain_id = ?
       ORDER BY created_at, id`,
    )
    .all(chainId) as any[]).map(row => ({
    id: row.id,
    paymentChainId: row.payment_chain_id,
    transactionLinkId: row.transaction_link_id,
    actualTransactionId: row.actual_transaction_id,
    kind: row.kind as SplitKind,
    amountMinor: row.amount_minor as number,
    notes: row.notes as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export function listPaymentChainLinks(db: FinanceDatabase, chainId: string) {
  getPaymentChain(db, chainId);
  const splits = listSplits(db, chainId);
  const byLink = new Map<string, typeof splits>();
  for (const split of splits) {
    const current = byLink.get(split.transactionLinkId) ?? [];
    current.push(split);
    byLink.set(split.transactionLinkId, current);
  }

  return (db
    .prepare(
      `SELECT id, actual_transaction_id, link_type, amount_minor,
              signed_amount_minor, occurred_on, confidence, status,
              metadata_json, created_at, updated_at
       FROM transaction_links WHERE payment_chain_id = ?
       ORDER BY COALESCE(occurred_on, created_at), created_at`,
    )
    .all(chainId) as any[]).map(row => ({
    id: row.id as string,
    actualTransactionId: row.actual_transaction_id as string,
    role: row.link_type as PaymentRole,
    amountMinor: row.amount_minor as number | null,
    signedAmountMinor: row.signed_amount_minor as number | null,
    occurredOn: row.occurred_on as string | null,
    confidence: row.confidence as number | null,
    status: row.status as string,
    metadata: json(row.metadata_json),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    splits: byLink.get(row.id) ?? [],
  }));
}

function listCases(db: FinanceDatabase, chainId: string) {
  return (db
    .prepare(
      `SELECT id, payment_chain_id, actual_transaction_id, confidence, status,
              subject, payload_json, resolution_json, created_at, updated_at
       FROM clarification_cases WHERE payment_chain_id = ?
       ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .all(chainId) as any[]).map(row => ({
    id: row.id as string,
    paymentChainId: row.payment_chain_id as string,
    actualTransactionId: row.actual_transaction_id as string | null,
    confidence: row.confidence as number | null,
    status: row.status as string,
    subject: row.subject as string | null,
    payload: json(row.payload_json) ?? {},
    resolution: json(row.resolution_json),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

function replaceSplits(
  db: FinanceDatabase,
  chainId: string,
  link: ReturnType<typeof listPaymentChainLinks>[number],
  splits: TransactionSplitInput[],
) {
  if (!Array.isArray(splits)) throw new ContractError('invalid_splits');
  const values = splits.map(split => {
    if (!split || !SPLITS.has(split.kind)) throw new ContractError('invalid_split_kind');
    const amount = integer(split.amountMinor);
    if (amount == null || amount < 0) throw new ContractError('invalid_split_amount');
    return { kind: split.kind, amount, notes: text(split.notes) };
  });
  const expected = Math.abs(link.signedAmountMinor ?? link.amountMinor ?? 0);
  const total = values.reduce((sum, split) => sum + split.amount, 0);
  if (values.length > 0 && total !== expected) {
    throw new ContractError('split_total_mismatch');
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM transaction_splits WHERE transaction_link_id = ?').run(link.id);
    const insert = db.prepare(
      `INSERT INTO transaction_splits (
        id, payment_chain_id, transaction_link_id, actual_transaction_id,
        kind, amount_minor, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const split of values) {
      insert.run(
        randomUUID(),
        chainId,
        link.id,
        link.actualTransactionId,
        split.kind,
        split.amount,
        split.notes,
        now,
        now,
      );
    }
  })();
}

function refreshStatus(db: FinanceDatabase, chainId: string) {
  const links = listPaymentChainLinks(db, chainId).filter(
    link => link.status === 'confirmed' && link.role !== 'fee',
  );
  const last = links.at(-1);
  const openCases = (
    db.prepare(
      `SELECT COUNT(*) AS count FROM clarification_cases
       WHERE payment_chain_id = ? AND status = 'open'`,
    ).get(chainId) as { count: number }
  ).count;

  let status: PaymentChainStatus = 'open';
  let settledAt: string | null = null;
  let failureReason: string | null = null;
  if (last?.role === 'settlement') {
    status = 'settled';
    settledAt = last.occurredOn;
  } else if (openCases > 0) {
    status = 'needs_clarification';
  } else if (last?.role === 'reversal') {
    status = 'reversed';
  } else if (last?.role === 'failed') {
    status = 'failed';
    failureReason =
      typeof last.metadata?.reason === 'string' ? last.metadata.reason : null;
  }

  db.prepare(
    `UPDATE payment_chains
     SET status = ?, settled_at = ?, failure_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, settledAt, failureReason, new Date().toISOString(), chainId);
}

export function confirmPaymentChainLink(
  db: FinanceDatabase,
  chainId: string,
  input: {
    actualTransactionId: string;
    role: PaymentRole;
    amountMinor: number;
    date: string;
    confidence?: number | null;
    metadata?: Record<string, unknown> | null;
    splits?: TransactionSplitInput[];
  },
) {
  const chain = getPaymentChain(db, chainId);
  const txId = text(input.actualTransactionId);
  const signedAmount = integer(input.amountMinor);
  const occurredOn = date(input.date);
  if (!txId) throw new ContractError('transaction_id_required');
  if (!ROLES.has(input.role)) throw new ContractError('invalid_payment_role');
  if (signedAmount == null) throw new ContractError('amount_required');
  if (!occurredOn) throw new ContractError('date_required');

  const current = db
    .prepare(
      `SELECT id FROM transaction_links
       WHERE payment_chain_id = ? AND actual_transaction_id = ?`,
    )
    .get(chainId, txId) as { id: string } | undefined;
  const id = current?.id ?? randomUUID();
  const now = new Date().toISOString();
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

  if (current) {
    db.prepare(
      `UPDATE transaction_links
       SET contract_id = ?, link_type = ?, amount_minor = ?,
           signed_amount_minor = ?, occurred_on = ?, confidence = ?,
           status = 'confirmed', metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      chain.contractId,
      input.role,
      Math.abs(signedAmount),
      signedAmount,
      occurredOn,
      input.confidence ?? 1,
      metadata,
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO transaction_links (
        id, actual_transaction_id, contract_id, payment_chain_id, link_type,
        amount_minor, signed_amount_minor, occurred_on, confidence, status,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
    ).run(
      id,
      txId,
      chain.contractId,
      chainId,
      input.role,
      Math.abs(signedAmount),
      signedAmount,
      occurredOn,
      input.confidence ?? 1,
      metadata,
      now,
      now,
    );
  }

  let link = listPaymentChainLinks(db, chainId).find(item => item.id === id)!;
  if (input.splits !== undefined) {
    replaceSplits(db, chainId, link, input.splits);
    link = listPaymentChainLinks(db, chainId).find(item => item.id === id)!;
  }
  refreshStatus(db, chainId);
  return link;
}

export function replacePaymentChainSplits(
  db: FinanceDatabase,
  chainId: string,
  linkId: string,
  splits: TransactionSplitInput[],
) {
  const link = listPaymentChainLinks(db, chainId).find(item => item.id === linkId);
  if (!link) throw new ContractError('payment_chain_link_not_found', 404);
  replaceSplits(db, chainId, link, splits);
  refreshStatus(db, chainId);
  return listPaymentChainLinks(db, chainId).find(item => item.id === linkId)!.splits;
}

export function removePaymentChainLink(
  db: FinanceDatabase,
  chainId: string,
  linkId: string,
) {
  getPaymentChain(db, chainId);
  const result = db
    .prepare('DELETE FROM transaction_links WHERE id = ? AND payment_chain_id = ?')
    .run(linkId, chainId);
  if (result.changes === 0) throw new ContractError('payment_chain_link_not_found', 404);
  refreshStatus(db, chainId);
}

function ensureCase(
  db: FinanceDatabase,
  chainId: string,
  candidate: TransactionCandidate,
  role: PaymentRole,
  score: number,
  reasons: string[],
) {
  const existing = db
    .prepare(
      `SELECT id FROM clarification_cases
       WHERE payment_chain_id = ? AND actual_transaction_id = ?
         AND kind = 'payment-chain-link' AND status = 'open'`,
    )
    .get(chainId, candidate.actualTransactionId) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO clarification_cases (
      id, kind, status, subject, payload_json, resolution_json,
      payment_chain_id, actual_transaction_id, confidence, created_at, updated_at
    ) VALUES (?, 'payment-chain-link', 'open', ?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'Unklare Buchungszuordnung',
    JSON.stringify({
      suggestedRole: role,
      reasons,
      date: candidate.date,
      amountMinor: candidate.amountMinor,
      payeeName: candidate.payeeName ?? null,
      notes: candidate.notes ?? null,
    }),
    chainId,
    candidate.actualTransactionId,
    score,
    now,
    now,
  );
  return id;
}

export function suggestPaymentChainLinks(
  db: FinanceDatabase,
  chainId: string,
  candidates: TransactionCandidate[],
) {
  const chain = getPaymentChain(db, chainId);
  if (!Array.isArray(candidates)) throw new ContractError('invalid_candidates');

  const linked = new Set(
    listPaymentChainLinks(db, chainId).map(link => link.actualTransactionId),
  );
  const expected = chain.expectedAmountMinor ?? 0;
  const valid = candidates
    .filter(
      candidate =>
        candidate &&
        typeof candidate.actualTransactionId === 'string' &&
        DATE.test(candidate.date) &&
        Number.isInteger(candidate.amountMinor) &&
        typeof candidate.accountId === 'string' &&
        !linked.has(candidate.actualTransactionId) &&
        (!chain.accountId || chain.accountId === candidate.accountId) &&
        (!chain.dueDate || days(chain.dueDate, candidate.date) <= 45),
    )
    .slice(0, 500)
    .sort((a, b) => a.date.localeCompare(b.date));

  const near = (candidate: TransactionCandidate) =>
    expected <= 0 ||
    Math.abs(Math.abs(candidate.amountMinor) - expected) <=
      Math.max(100, Math.round(expected * 0.12));

  const suggestions: Array<{
    actualTransactionId: string;
    role: PaymentRole;
    score: number;
    reasons: string[];
    clarificationCaseId: string | null;
  }> = [];

  for (let index = 0; index < valid.length; index += 1) {
    const candidate = valid[index];
    const haystack = (
      (candidate.payeeName ?? '') + ' ' + (candidate.notes ?? '')
    ).toLocaleLowerCase();
    const feeKeyword = /gebühr|gebuhr|mahn|rücklast|rucklast|return fee|bank fee/u.test(
      haystack,
    );
    const smallFee =
      candidate.amountMinor < 0 &&
      expected > 0 &&
      Math.abs(candidate.amountMinor) <= Math.max(1500, expected * 0.25);

    let role: PaymentRole | null = null;
    let score = 0;
    const reasons: string[] = [];

    if (candidate.amountMinor > 0 && near(candidate)) {
      role = 'reversal';
      score = 0.72;
      reasons.push('credit-near-expected');
    } else if (candidate.amountMinor < 0 && near(candidate)) {
      const earlierReversal = valid
        .slice(0, index)
        .some(item => item.amountMinor > 0 && near(item));
      const laterReversal = valid
        .slice(index + 1)
        .some(
          item =>
            item.amountMinor > 0 &&
            near(item) &&
            days(candidate.date, item.date) <= 21,
        );
      if (earlierReversal) {
        role = 'settlement';
        score = 0.88;
        reasons.push('debit-after-reversal');
      } else if (laterReversal) {
        role = 'payment_attempt';
        score = 0.86;
        reasons.push('debit-before-reversal');
      } else {
        role = 'settlement';
        score = 0.68;
        reasons.push('single-debit-near-expected');
      }
    } else if (candidate.amountMinor < 0 && (feeKeyword || smallFee)) {
      role = 'fee';
      score = feeKeyword ? 0.72 : 0.52;
      reasons.push(feeKeyword ? 'fee-keyword' : 'small-debit');
    }

    if (!role) continue;
    if (chain.accountId && chain.accountId === candidate.accountId) {
      score += 0.08;
      reasons.push('account');
    }
    if (chain.dueDate && days(chain.dueDate, candidate.date) <= 10) {
      score += 0.08;
      reasons.push('date');
    }
    score = Math.min(1, Math.round(score * 100) / 100);
    if (score < 0.45) continue;

    const clarificationCaseId =
      score < 0.75
        ? ensureCase(db, chainId, candidate, role, score, reasons)
        : null;
    suggestions.push({
      actualTransactionId: candidate.actualTransactionId,
      role,
      score,
      reasons,
      clarificationCaseId,
    });
  }

  refreshStatus(db, chainId);
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 30);
}

export function resolveClarificationCase(
  db: FinanceDatabase,
  chainId: string,
  caseId: string,
  input:
    | { action: 'dismiss' }
    | {
        action: 'confirm';
        role: PaymentRole;
        amountMinor: number;
        date: string;
        splits?: TransactionSplitInput[];
      },
) {
  getPaymentChain(db, chainId);
  const row = db
    .prepare(
      `SELECT actual_transaction_id, confidence
       FROM clarification_cases
       WHERE id = ? AND payment_chain_id = ? AND status = 'open'`,
    )
    .get(caseId, chainId) as
    | { actual_transaction_id: string | null; confidence: number | null }
    | undefined;
  if (!row) throw new ContractError('clarification_case_not_found', 404);

  const now = new Date().toISOString();
  if (input.action === 'dismiss') {
    db.prepare(
      `UPDATE clarification_cases
       SET status = 'dismissed', resolution_json = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify({ action: 'dismiss' }), now, caseId);
    refreshStatus(db, chainId);
    return;
  }

  if (!row.actual_transaction_id) {
    throw new ContractError('clarification_transaction_missing');
  }
  confirmPaymentChainLink(db, chainId, {
    actualTransactionId: row.actual_transaction_id,
    role: input.role,
    amountMinor: input.amountMinor,
    date: input.date,
    confidence: row.confidence,
    splits: input.splits,
    metadata: { clarificationCaseId: caseId },
  });
  db.prepare(
    `UPDATE clarification_cases
     SET status = 'resolved', resolution_json = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify({ action: 'confirm', role: input.role }), now, caseId);
  refreshStatus(db, chainId);
}

export function getPaymentChainDetail(db: FinanceDatabase, chainId: string) {
  const chain = getPaymentChain(db, chainId);
  const links = listPaymentChainLinks(db, chainId);
  const clarifications = listCases(db, chainId);
  const confirmed = links.filter(link => link.status === 'confirmed');
  const settlement = [...confirmed]
    .reverse()
    .find(link => link.role === 'settlement');

  const finalPaymentMinor = settlement
    ? settlement.splits
        .filter(split => split.kind === 'contract_amount')
        .reduce((sum, split) => sum + split.amountMinor, 0) ||
      Math.abs(settlement.signedAmountMinor ?? settlement.amountMinor ?? 0)
    : 0;

  const feeTotalMinor = confirmed.reduce((sum, link) => {
    const feeSplits = link.splits.filter(split => split.kind !== 'contract_amount');
    if (feeSplits.length > 0) {
      return sum + feeSplits.reduce((value, split) => value + split.amountMinor, 0);
    }
    return link.role === 'fee'
      ? sum + Math.abs(link.signedAmountMinor ?? link.amountMinor ?? 0)
      : sum;
  }, 0);

  return {
    chain,
    links,
    clarifications,
    summary: {
      attemptCount: confirmed.filter(
        link => link.role === 'payment_attempt' || link.role === 'settlement',
      ).length,
      reversalCount: confirmed.filter(link => link.role === 'reversal').length,
      finalPaymentMinor,
      feeTotalMinor,
      economicTotalMinor: finalPaymentMinor + feeTotalMinor,
      finalSettlementTransactionId: settlement?.actualTransactionId ?? null,
    },
  };
}
