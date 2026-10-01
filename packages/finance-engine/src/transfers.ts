import { randomUUID } from 'node:crypto';

import {
  ContractError,
  type TransactionCandidate,
} from './contracts.js';
import type { FinanceDatabase } from './db.js';

export type TransferMatchKind = 'internal_transfer' | 'credit_card_payment';
export type TransferMatchStatus = 'proposed' | 'confirmed';

export type TransferCandidate = TransactionCandidate & {
  accountName?: string | null;
  transferId?: string | null;
  transferAccountId?: string | null;
};

export type CreditCardProfileInput = {
  actualAccountId: string;
  fundingAccountId?: string | null;
  label?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ContractError('invalid_text');
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredText(value: unknown, code: string): string {
  const text = optionalText(value);
  if (!text) throw new ContractError(code);
  return text;
}

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

function daysBetween(a: string, b: string): number {
  const left = Date.parse(a + 'T00:00:00Z');
  const right = Date.parse(b + 'T00:00:00Z');
  return Math.abs(left - right) / 86_400_000;
}

function validateCandidate(candidate: TransferCandidate): boolean {
  return Boolean(
    candidate &&
      typeof candidate.actualTransactionId === 'string' &&
      DATE.test(candidate.date) &&
      Number.isInteger(candidate.amountMinor) &&
      typeof candidate.accountId === 'string',
  );
}

type TransferMatchRow = {
  id: string;
  source_actual_transaction_id: string;
  target_actual_transaction_id: string;
  source_account_id: string | null;
  target_account_id: string | null;
  amount_minor: number | null;
  source_date: string | null;
  target_date: string | null;
  match_kind: TransferMatchKind;
  confidence: number | null;
  status: TransferMatchStatus;
  confirmed_at: string | null;
  source: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

function mapTransferMatch(row: TransferMatchRow) {
  return {
    id: row.id,
    sourceActualTransactionId: row.source_actual_transaction_id,
    targetActualTransactionId: row.target_actual_transaction_id,
    sourceAccountId: row.source_account_id,
    targetAccountId: row.target_account_id,
    amountMinor: row.amount_minor,
    sourceDate: row.source_date,
    targetDate: row.target_date,
    kind: row.match_kind,
    confidence: row.confidence,
    status: row.status,
    confirmedAt: row.confirmed_at,
    source: row.source,
    metadata: parseJson(row.metadata_json),
    economicEffectMinor: 0,
    countsAsIncomeExpense: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTransferMatches(db: FinanceDatabase) {
  return (
    db
      .prepare(
        `SELECT *
         FROM transfer_matches
         ORDER BY
           CASE status WHEN 'confirmed' THEN 0 ELSE 1 END,
           COALESCE(target_date, source_date, created_at) DESC,
           created_at DESC`,
      )
      .all() as TransferMatchRow[]
  ).map(mapTransferMatch);
}

function getTransferMatch(db: FinanceDatabase, id: string) {
  const row = db
    .prepare('SELECT * FROM transfer_matches WHERE id = ?')
    .get(id) as TransferMatchRow | undefined;
  if (!row) throw new ContractError('transfer_match_not_found', 404);
  return mapTransferMatch(row);
}

type CreditCardRow = {
  actual_account_id: string;
  funding_account_id: string | null;
  label: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function mapCreditCard(row: CreditCardRow) {
  return {
    actualAccountId: row.actual_account_id,
    fundingAccountId: row.funding_account_id,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCreditCardProfiles(db: FinanceDatabase) {
  return (
    db
      .prepare(
        `SELECT actual_account_id, funding_account_id, label, status,
                created_at, updated_at
         FROM credit_card_accounts
         WHERE status = 'active'
         ORDER BY COALESCE(label, actual_account_id) COLLATE NOCASE`,
      )
      .all() as CreditCardRow[]
  ).map(mapCreditCard);
}

export function upsertCreditCardProfile(
  db: FinanceDatabase,
  input: CreditCardProfileInput,
) {
  const actualAccountId = requiredText(
    input.actualAccountId,
    'account_id_required',
  );
  const fundingAccountId = optionalText(input.fundingAccountId);
  if (fundingAccountId === actualAccountId) {
    throw new ContractError('credit_card_funding_account_same');
  }
  const label = optionalText(input.label);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO credit_card_accounts (
      actual_account_id, funding_account_id, label, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
    ON CONFLICT(actual_account_id) DO UPDATE SET
      funding_account_id = excluded.funding_account_id,
      label = excluded.label,
      status = 'active',
      updated_at = excluded.updated_at`,
  ).run(actualAccountId, fundingAccountId, label, now, now);

  return listCreditCardProfiles(db).find(
    profile => profile.actualAccountId === actualAccountId,
  )!;
}

export function removeCreditCardProfile(
  db: FinanceDatabase,
  actualAccountId: string,
) {
  const result = db
    .prepare('DELETE FROM credit_card_accounts WHERE actual_account_id = ?')
    .run(actualAccountId);
  if (result.changes === 0) {
    throw new ContractError('credit_card_profile_not_found', 404);
  }
}

function creditCardMap(db: FinanceDatabase) {
  return new Map(
    listCreditCardProfiles(db).map(profile => [
      profile.actualAccountId,
      profile,
    ]),
  );
}

function transactionAlreadyConfirmed(
  db: FinanceDatabase,
  transactionId: string,
  exceptMatchId?: string,
) {
  const row = db
    .prepare(
      `SELECT id FROM transfer_matches
       WHERE status = 'confirmed'
         AND id <> COALESCE(?, '')
         AND (
           source_actual_transaction_id = ?
           OR target_actual_transaction_id = ?
         )
       LIMIT 1`,
    )
    .get(exceptMatchId ?? null, transactionId, transactionId) as
    | { id: string }
    | undefined;
  return Boolean(row);
}

function pairKind(
  cards: ReturnType<typeof creditCardMap>,
  source: TransferCandidate,
  target: TransferCandidate,
): TransferMatchKind {
  const targetCard = cards.get(target.accountId);
  if (
    targetCard &&
    (!targetCard.fundingAccountId ||
      targetCard.fundingAccountId === source.accountId)
  ) {
    return 'credit_card_payment';
  }
  return 'internal_transfer';
}

function scorePair(
  cards: ReturnType<typeof creditCardMap>,
  source: TransferCandidate,
  target: TransferCandidate,
) {
  if (source.accountId === target.accountId) return null;
  if (source.amountMinor >= 0 || target.amountMinor <= 0) return null;

  const amountDifference = Math.abs(
    Math.abs(source.amountMinor) - Math.abs(target.amountMinor),
  );
  if (amountDifference > 1) return null;

  const dateDistance = daysBetween(source.date, target.date);
  if (!Number.isFinite(dateDistance) || dateDistance > 5) return null;

  let score = 0.58;
  const reasons: string[] = ['opposite-equal-amount'];

  if (
    source.transferId === target.actualTransactionId ||
    target.transferId === source.actualTransactionId
  ) {
    score += 0.36;
    reasons.push('actual-transfer-id');
  }

  const sourcePointsToTarget =
    source.transferAccountId === target.accountId;
  const targetPointsToSource =
    target.transferAccountId === source.accountId;

  if (sourcePointsToTarget && targetPointsToSource) {
    score += 0.34;
    reasons.push('reciprocal-transfer-account');
  } else if (sourcePointsToTarget || targetPointsToSource) {
    score += 0.2;
    reasons.push('transfer-account');
  }

  if (dateDistance === 0) {
    score += 0.14;
    reasons.push('same-date');
  } else if (dateDistance <= 1) {
    score += 0.1;
    reasons.push('date-near');
  } else if (dateDistance <= 3) {
    score += 0.05;
    reasons.push('date-close');
  }

  const kind = pairKind(cards, source, target);
  if (kind === 'credit_card_payment') {
    const profile = cards.get(target.accountId)!;
    if (profile.fundingAccountId === source.accountId) {
      score += 0.22;
      reasons.push('credit-card-funding-account');
    } else {
      score += 0.08;
      reasons.push('credit-card-target');
    }
  }

  return {
    kind,
    score: Math.min(1, Math.round(score * 100) / 100),
    reasons,
  };
}

function storeTransferMatch(
  db: FinanceDatabase,
  source: TransferCandidate,
  target: TransferCandidate,
  kind: TransferMatchKind,
  confidence: number,
  status: TransferMatchStatus,
  sourceType: string,
  reasons: string[],
) {
  if (transactionAlreadyConfirmed(db, source.actualTransactionId)) {
    throw new ContractError('source_transaction_already_matched');
  }
  if (transactionAlreadyConfirmed(db, target.actualTransactionId)) {
    throw new ContractError('target_transaction_already_matched');
  }

  const existing = db
    .prepare(
      `SELECT id FROM transfer_matches
       WHERE source_actual_transaction_id = ?
         AND target_actual_transaction_id = ?`,
    )
    .get(source.actualTransactionId, target.actualTransactionId) as
    | { id: string }
    | undefined;
  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  const metadata = JSON.stringify({
    reasons,
    sourceAccountName: source.accountName ?? null,
    targetAccountName: target.accountName ?? null,
  });

  if (existing) {
    db.prepare(
      `UPDATE transfer_matches
       SET source_account_id = ?, target_account_id = ?, amount_minor = ?,
           source_date = ?, target_date = ?, match_kind = ?, confidence = ?,
           status = ?, confirmed_at = ?, source = ?, metadata_json = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      source.accountId,
      target.accountId,
      Math.abs(source.amountMinor),
      source.date,
      target.date,
      kind,
      confidence,
      status,
      status === 'confirmed' ? now : null,
      sourceType,
      metadata,
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO transfer_matches (
        id, source_actual_transaction_id, target_actual_transaction_id,
        source_account_id, target_account_id, amount_minor, source_date,
        target_date, match_kind, confidence, status, confirmed_at, source,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      source.actualTransactionId,
      target.actualTransactionId,
      source.accountId,
      target.accountId,
      Math.abs(source.amountMinor),
      source.date,
      target.date,
      kind,
      confidence,
      status,
      status === 'confirmed' ? now : null,
      sourceType,
      metadata,
      now,
      now,
    );
  }

  return getTransferMatch(db, id);
}

export function confirmTransferMatch(
  db: FinanceDatabase,
  input: {
    source: TransferCandidate;
    target: TransferCandidate;
    kind?: TransferMatchKind;
    confidence?: number;
    sourceType?: string;
  },
) {
  if (!validateCandidate(input.source) || !validateCandidate(input.target)) {
    throw new ContractError('invalid_transfer_candidate');
  }
  const cards = creditCardMap(db);
  const scored = scorePair(cards, input.source, input.target);
  if (!scored) throw new ContractError('invalid_transfer_pair');

  return storeTransferMatch(
    db,
    input.source,
    input.target,
    input.kind ?? scored.kind,
    input.confidence ?? scored.score,
    'confirmed',
    input.sourceType ?? 'manual',
    scored.reasons,
  );
}

export function removeTransferMatch(db: FinanceDatabase, id: string) {
  const result = db.prepare('DELETE FROM transfer_matches WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new ContractError('transfer_match_not_found', 404);
  }
}

function openTransferClarification(
  db: FinanceDatabase,
  source: TransferCandidate,
  target: TransferCandidate,
  kind: TransferMatchKind,
  score: number,
  reasons: string[],
) {
  const existing = db
    .prepare(
      `SELECT id FROM clarification_cases
       WHERE kind = 'transfer-match'
         AND status = 'open'
         AND json_extract(payload_json, '$.source.actualTransactionId') = ?
         AND json_extract(payload_json, '$.target.actualTransactionId') = ?
       LIMIT 1`,
    )
    .get(source.actualTransactionId, target.actualTransactionId) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO clarification_cases (
      id, kind, status, subject, payload_json, resolution_json,
      confidence, created_at, updated_at
    ) VALUES (?, 'transfer-match', 'open', ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    kind === 'credit_card_payment'
      ? 'Unklare Kreditkartenzahlung'
      : 'Unklare Umbuchung',
    JSON.stringify({
      source,
      target,
      suggestedKind: kind,
      reasons,
    }),
    score,
    now,
    now,
  );
  return id;
}

function listTransferClarifications(db: FinanceDatabase) {
  return (
    db
      .prepare(
        `SELECT id, status, subject, payload_json, resolution_json,
                confidence, created_at, updated_at
         FROM clarification_cases
         WHERE kind = 'transfer-match'
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC`,
      )
      .all() as Array<{
      id: string;
      status: string;
      subject: string | null;
      payload_json: string;
      resolution_json: string | null;
      confidence: number | null;
      created_at: string;
      updated_at: string;
    }>
  ).map(row => ({
    id: row.id,
    status: row.status,
    subject: row.subject,
    confidence: row.confidence,
    payload: parseJson(row.payload_json) ?? {},
    resolution: parseJson(row.resolution_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function suggestTransferMatches(
  db: FinanceDatabase,
  candidates: TransferCandidate[],
) {
  if (!Array.isArray(candidates)) throw new ContractError('invalid_candidates');
  const valid = candidates.filter(validateCandidate).slice(0, 600);
  const negative = valid.filter(candidate => candidate.amountMinor < 0);
  const positive = valid.filter(candidate => candidate.amountMinor > 0);
  const cards = creditCardMap(db);

  const pairCandidates: Array<{
    source: TransferCandidate;
    target: TransferCandidate;
    kind: TransferMatchKind;
    score: number;
    reasons: string[];
  }> = [];

  for (const source of negative) {
    if (transactionAlreadyConfirmed(db, source.actualTransactionId)) continue;
    for (const target of positive) {
      if (transactionAlreadyConfirmed(db, target.actualTransactionId)) continue;
      const scored = scorePair(cards, source, target);
      if (!scored || scored.score < 0.63) continue;
      pairCandidates.push({
        source,
        target,
        kind: scored.kind,
        score: scored.score,
        reasons: scored.reasons,
      });
    }
  }

  pairCandidates.sort((a, b) => b.score - a.score);

  const usedSources = new Set<string>();
  const usedTargets = new Set<string>();
  const suggestions: Array<{
    sourceActualTransactionId: string;
    targetActualTransactionId: string;
    kind: TransferMatchKind;
    score: number;
    reasons: string[];
    matchId: string | null;
    status: TransferMatchStatus | 'clarification';
    clarificationCaseId: string | null;
  }> = [];

  for (const pair of pairCandidates) {
    if (
      usedSources.has(pair.source.actualTransactionId) ||
      usedTargets.has(pair.target.actualTransactionId)
    ) {
      continue;
    }

    const sourceAlternatives = pairCandidates.filter(
      candidate =>
        candidate.source.actualTransactionId ===
          pair.source.actualTransactionId &&
        candidate.target.actualTransactionId !==
          pair.target.actualTransactionId,
    );
    const closeAlternative = sourceAlternatives.some(
      alternative => Math.abs(alternative.score - pair.score) <= 0.05,
    );

    usedSources.add(pair.source.actualTransactionId);
    usedTargets.add(pair.target.actualTransactionId);

    if (pair.score >= 0.94 && !closeAlternative) {
      const match = storeTransferMatch(
        db,
        pair.source,
        pair.target,
        pair.kind,
        pair.score,
        'confirmed',
        pair.reasons.includes('actual-transfer-id')
          ? 'actual-transfer'
          : 'recognition',
        pair.reasons,
      );
      suggestions.push({
        sourceActualTransactionId: pair.source.actualTransactionId,
        targetActualTransactionId: pair.target.actualTransactionId,
        kind: pair.kind,
        score: pair.score,
        reasons: pair.reasons,
        matchId: match.id,
        status: 'confirmed',
        clarificationCaseId: null,
      });
      continue;
    }

    if (pair.score >= 0.78 && !closeAlternative) {
      const match = storeTransferMatch(
        db,
        pair.source,
        pair.target,
        pair.kind,
        pair.score,
        'proposed',
        'recognition',
        pair.reasons,
      );
      suggestions.push({
        sourceActualTransactionId: pair.source.actualTransactionId,
        targetActualTransactionId: pair.target.actualTransactionId,
        kind: pair.kind,
        score: pair.score,
        reasons: pair.reasons,
        matchId: match.id,
        status: 'proposed',
        clarificationCaseId: null,
      });
      continue;
    }

    const clarificationCaseId = openTransferClarification(
      db,
      pair.source,
      pair.target,
      pair.kind,
      pair.score,
      closeAlternative
        ? [...pair.reasons, 'ambiguous-candidates']
        : pair.reasons,
    );
    suggestions.push({
      sourceActualTransactionId: pair.source.actualTransactionId,
      targetActualTransactionId: pair.target.actualTransactionId,
      kind: pair.kind,
      score: pair.score,
      reasons: closeAlternative
        ? [...pair.reasons, 'ambiguous-candidates']
        : pair.reasons,
      matchId: null,
      status: 'clarification',
      clarificationCaseId,
    });
  }

  return {
    suggestions: suggestions.slice(0, 50),
    matches: listTransferMatches(db),
    clarifications: listTransferClarifications(db),
  };
}

export function confirmProposedTransferMatch(
  db: FinanceDatabase,
  id: string,
) {
  const match = getTransferMatch(db, id);
  if (match.status === 'confirmed') return match;
  if (
    transactionAlreadyConfirmed(
      db,
      match.sourceActualTransactionId,
      match.id,
    ) ||
    transactionAlreadyConfirmed(
      db,
      match.targetActualTransactionId,
      match.id,
    )
  ) {
    throw new ContractError('transfer_transaction_already_matched');
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE transfer_matches
     SET status = 'confirmed', confirmed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now, now, id);
  return getTransferMatch(db, id);
}

export function resolveTransferClarification(
  db: FinanceDatabase,
  caseId: string,
  input:
    | { action: 'dismiss' }
    | {
        action: 'confirm';
        kind?: TransferMatchKind;
      },
) {
  const row = db
    .prepare(
      `SELECT payload_json, confidence
       FROM clarification_cases
       WHERE id = ? AND kind = 'transfer-match' AND status = 'open'`,
    )
    .get(caseId) as
    | { payload_json: string; confidence: number | null }
    | undefined;
  if (!row) throw new ContractError('clarification_case_not_found', 404);

  const payload = parseJson(row.payload_json) as
    | {
        source?: TransferCandidate;
        target?: TransferCandidate;
        suggestedKind?: TransferMatchKind;
      }
    | null;
  const now = new Date().toISOString();

  if (input.action === 'dismiss') {
    db.prepare(
      `UPDATE clarification_cases
       SET status = 'dismissed', resolution_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify({ action: 'dismiss' }), now, caseId);
    return;
  }

  if (!payload?.source || !payload.target) {
    throw new ContractError('clarification_payload_invalid');
  }

  const match = confirmTransferMatch(db, {
    source: payload.source,
    target: payload.target,
    kind: input.kind ?? payload.suggestedKind,
    confidence: row.confidence ?? undefined,
    sourceType: 'clarification',
  });
  db.prepare(
    `UPDATE clarification_cases
     SET status = 'resolved', resolution_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify({
      action: 'confirm',
      transferMatchId: match.id,
      kind: match.kind,
    }),
    now,
    caseId,
  );
  return match;
}

export function analyzeCreditCards(
  db: FinanceDatabase,
  candidates: TransferCandidate[],
) {
  if (!Array.isArray(candidates)) throw new ContractError('invalid_candidates');
  const profiles = listCreditCardProfiles(db);
  const confirmedMatches = listTransferMatches(db).filter(
    match => match.status === 'confirmed',
  );
  const matchedTransactionIds = new Set(
    confirmedMatches.flatMap(match => [
      match.sourceActualTransactionId,
      match.targetActualTransactionId,
    ]),
  );

  return profiles.map(profile => {
    const cardTransactions = candidates.filter(
      candidate =>
        validateCandidate(candidate) &&
        candidate.accountId === profile.actualAccountId,
    );

    const purchases = cardTransactions.filter(
      candidate =>
        candidate.amountMinor < 0 &&
        !matchedTransactionIds.has(candidate.actualTransactionId),
    );
    const refunds = cardTransactions.filter(
      candidate =>
        candidate.amountMinor > 0 &&
        !matchedTransactionIds.has(candidate.actualTransactionId),
    );
    const payments = confirmedMatches.filter(
      match =>
        match.kind === 'credit_card_payment' &&
        match.targetAccountId === profile.actualAccountId,
    );

    const purchaseTotalMinor = purchases.reduce(
      (sum, transaction) => sum + Math.abs(transaction.amountMinor),
      0,
    );
    const refundTotalMinor = refunds.reduce(
      (sum, transaction) => sum + Math.abs(transaction.amountMinor),
      0,
    );
    const paymentTotalMinor = payments.reduce(
      (sum, match) => sum + Math.abs(match.amountMinor ?? 0),
      0,
    );

    return {
      ...profile,
      purchaseCount: purchases.length,
      purchaseTotalMinor,
      refundCount: refunds.length,
      refundTotalMinor,
      paymentCount: payments.length,
      paymentTotalMinor,
      economicExpenseMinor: Math.max(0, purchaseTotalMinor - refundTotalMinor),
      paymentTransactionIds: payments.flatMap(match => [
        match.sourceActualTransactionId,
        match.targetActualTransactionId,
      ]),
    };
  });
}

export function getTransferOverview(
  db: FinanceDatabase,
  candidates?: TransferCandidate[],
) {
  return {
    matches: listTransferMatches(db),
    clarifications: listTransferClarifications(db),
    creditCards: candidates ? analyzeCreditCards(db, candidates) : [],
  };
}
