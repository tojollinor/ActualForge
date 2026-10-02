import { randomUUID } from 'node:crypto';

import {
  ContractError,
  updateContract,
} from './contracts.js';
import type { FinanceDatabase } from './db.js';
import {
  resolveClarificationCase as resolvePaymentChainClarification,
  type PaymentRole,
  type TransactionSplitInput,
} from './payment-chains.js';
import {
  resolveTransferClarification,
  type TransferMatchKind,
} from './transfers.js';

export type ClarificationStatus = 'open' | 'resolved' | 'dismissed';

type ClarificationRow = {
  id: string;
  kind: string;
  status: ClarificationStatus;
  subject: string | null;
  payload_json: string;
  resolution_json: string | null;
  payment_chain_id: string | null;
  actual_transaction_id: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
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

function mapCase(row: ClarificationRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    payload: parseJson(row.payload_json) ?? {},
    resolution: parseJson(row.resolution_json),
    paymentChainId: row.payment_chain_id,
    actualTransactionId: row.actual_transaction_id,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function markCase(
  db: FinanceDatabase,
  id: string,
  status: ClarificationStatus,
  resolution: Record<string, unknown>,
) {
  db.prepare(
    `UPDATE clarification_cases
     SET status = ?, resolution_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    JSON.stringify(resolution),
    new Date().toISOString(),
    id,
  );
}

export function refreshContractAmountClarifications(db: FinanceDatabase) {
  const contracts = db
    .prepare(
      `SELECT id, title, amount_minor, amount_mode
       FROM contracts
       WHERE status = 'active'
         AND amount_mode = 'fixed'
         AND amount_minor IS NOT NULL
         AND amount_minor > 0`,
    )
    .all() as Array<{
    id: string;
    title: string;
    amount_minor: number;
    amount_mode: string;
  }>;

  for (const contract of contracts) {
    const observations = db
      .prepare(
        `SELECT actual_transaction_id, occurred_on, amount_minor, created_at
         FROM transaction_links
         WHERE contract_id = ?
           AND status = 'confirmed'
           AND amount_minor IS NOT NULL
         ORDER BY COALESCE(occurred_on, created_at) DESC, created_at DESC
         LIMIT 2`,
      )
      .all(contract.id) as Array<{
      actual_transaction_id: string;
      occurred_on: string | null;
      amount_minor: number;
      created_at: string;
    }>;

    if (observations.length < 2) continue;
    const [latest, previous] = observations;
    if (Math.abs(latest.amount_minor) !== Math.abs(previous.amount_minor)) continue;

    const current = Math.abs(contract.amount_minor);
    const suggested = Math.abs(latest.amount_minor);
    const ratio = Math.abs(suggested - current) / Math.max(current, 1);
    if (ratio <= 0.05) continue;

    const existing = db
      .prepare(
        `SELECT id
         FROM clarification_cases
         WHERE kind = 'contract-amount-change'
           AND json_extract(payload_json, '$.contractId') = ?
           AND json_extract(payload_json, '$.suggestedAmountMinor') = ?
         LIMIT 1`,
      )
      .get(contract.id, suggested) as { id: string } | undefined;
    if (existing) continue;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO clarification_cases (
        id, kind, status, subject, payload_json, resolution_json,
        payment_chain_id, actual_transaction_id, confidence,
        created_at, updated_at
      ) VALUES (?, 'contract-amount-change', 'open', ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      'Dauerhafte Preisänderung erkannt',
      JSON.stringify({
        contractId: contract.id,
        contractTitle: contract.title,
        currentAmountMinor: current,
        suggestedAmountMinor: suggested,
        changeRatio: ratio,
        observations: observations.map(observation => ({
          actualTransactionId: observation.actual_transaction_id,
          date: observation.occurred_on ?? observation.created_at.slice(0, 10),
          amountMinor: Math.abs(observation.amount_minor),
        })),
      }),
      latest.actual_transaction_id,
      0.9,
      now,
      now,
    );
  }
}

export function listClarificationCases(
  db: FinanceDatabase,
  status?: ClarificationStatus | null,
) {
  refreshContractAmountClarifications(db);

  const rows = status
    ? (db
        .prepare(
          `SELECT *
           FROM clarification_cases
           WHERE status = ?
           ORDER BY
             CASE kind
               WHEN 'contract-amount-change' THEN 0
               WHEN 'payment-chain-link' THEN 1
               WHEN 'transfer-match' THEN 2
               ELSE 3
             END,
             COALESCE(confidence, 0) DESC,
             created_at DESC`,
        )
        .all(status) as ClarificationRow[])
    : (db
        .prepare(
          `SELECT *
           FROM clarification_cases
           ORDER BY
             CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
             COALESCE(confidence, 0) DESC,
             created_at DESC`,
        )
        .all() as ClarificationRow[]);

  return rows.map(mapCase);
}

type GenericResolution =
  | { action: 'dismiss' }
  | {
      action: 'confirm';
      role?: PaymentRole;
      amountMinor?: number;
      date?: string;
      splits?: TransactionSplitInput[];
      transferKind?: TransferMatchKind;
    };

export function resolveClarification(
  db: FinanceDatabase,
  id: string,
  input: GenericResolution,
) {
  const row = db
    .prepare('SELECT * FROM clarification_cases WHERE id = ?')
    .get(id) as ClarificationRow | undefined;
  if (!row) throw new ContractError('clarification_case_not_found', 404);
  if (row.status !== 'open') {
    throw new ContractError('clarification_case_already_resolved', 409);
  }

  const payload = parseJson(row.payload_json) ?? {};

  if (row.kind === 'payment-chain-link') {
    if (!row.payment_chain_id) {
      throw new ContractError('clarification_payment_chain_missing');
    }

    if (input.action === 'dismiss') {
      resolvePaymentChainClarification(
        db,
        row.payment_chain_id,
        id,
        { action: 'dismiss' },
      );
    } else {
      const role =
        input.role ??
        (typeof payload.suggestedRole === 'string'
          ? (payload.suggestedRole as PaymentRole)
          : undefined);
      const amountMinor =
        input.amountMinor ??
        (typeof payload.amountMinor === 'number'
          ? payload.amountMinor
          : undefined);
      const date =
        input.date ??
        (typeof payload.date === 'string' ? payload.date : undefined);

      if (!role || amountMinor == null || !date) {
        throw new ContractError('clarification_resolution_incomplete');
      }

      resolvePaymentChainClarification(
        db,
        row.payment_chain_id,
        id,
        {
          action: 'confirm',
          role,
          amountMinor,
          date,
          splits: input.splits,
        },
      );
    }

    return listClarificationCases(db);
  }

  if (row.kind === 'transfer-match') {
    resolveTransferClarification(
      db,
      id,
      input.action === 'dismiss'
        ? { action: 'dismiss' }
        : {
            action: 'confirm',
            kind:
              input.transferKind ??
              (typeof payload.suggestedKind === 'string'
                ? (payload.suggestedKind as TransferMatchKind)
                : undefined),
          },
    );
    return listClarificationCases(db);
  }

  if (row.kind === 'contract-amount-change') {
    if (input.action === 'dismiss') {
      markCase(db, id, 'dismissed', { action: 'dismiss' });
      return listClarificationCases(db);
    }

    const contractId =
      typeof payload.contractId === 'string' ? payload.contractId : null;
    const suggestedAmount =
      input.amountMinor ??
      (typeof payload.suggestedAmountMinor === 'number'
        ? payload.suggestedAmountMinor
        : null);
    if (!contractId || suggestedAmount == null || !Number.isInteger(suggestedAmount)) {
      throw new ContractError('clarification_resolution_incomplete');
    }

    updateContract(db, contractId, {
      amountMinor: Math.abs(suggestedAmount),
    });
    markCase(db, id, 'resolved', {
      action: 'confirm',
      contractId,
      amountMinor: Math.abs(suggestedAmount),
    });
    return listClarificationCases(db);
  }

  if (input.action === 'dismiss') {
    markCase(db, id, 'dismissed', { action: 'dismiss' });
    return listClarificationCases(db);
  }

  throw new ContractError('clarification_kind_not_resolvable', 409);
}
