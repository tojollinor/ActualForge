import { v4 as uuidv4 } from 'uuid';

import * as asyncStorage from '#platform/server/asyncStorage';
import { fetch } from '#platform/server/fetch';
import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { PostError } from '#server/errors';
import { getServer } from '#server/server-config';
import { q } from '#shared/query';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type ActualCoreDataset = 'accounts' | 'transactions' | 'categories' | 'schedules';
type ActualCoreRecord = Record<string, unknown>;

type TransactionSnapshotRow = {
  id: string;
  is_parent: number;
  is_child: number;
  parent_id: string | null;
  account: string;
  category: string | null;
  payee: string | null;
  payee_name: string | null;
  category_name: string | null;
  amount: number;
  notes: string | null;
  date: number;
  imported_id: string | null;
  transfer_id: string | null;
  transfer_account_id: string | null;
  cleared: number;
  reconciled: number;
  schedule: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export type ActualForgeHandlers = {
  'actualforge-overview': () => Promise<unknown>;
  'actualforge-contracts-list': () => Promise<unknown>;
  'actualforge-contract-create': (input: Record<string, unknown>) => Promise<unknown>;
  'actualforge-contract-get': (input: { id: string }) => Promise<unknown>;
  'actualforge-contract-update': (input: {
    id: string;
    changes: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-contract-link': (input: {
    id: string;
    link: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-contract-unlink': (input: {
    id: string;
    linkId: string;
  }) => Promise<unknown>;
  'actualforge-contract-suggestions': (input: {
    id: string;
    candidates: Array<Record<string, unknown>>;
  }) => Promise<unknown>;
  'actualforge-payment-chains-list': () => Promise<unknown>;
  'actualforge-payment-chain-create': (input: Record<string, unknown>) => Promise<unknown>;
  'actualforge-payment-chain-get': (input: { id: string }) => Promise<unknown>;
  'actualforge-payment-chain-link': (input: {
    id: string;
    link: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-payment-chain-unlink': (input: {
    id: string;
    linkId: string;
  }) => Promise<unknown>;
  'actualforge-payment-chain-splits': (input: {
    id: string;
    linkId: string;
    splits: Array<Record<string, unknown>>;
  }) => Promise<unknown>;
  'actualforge-payment-chain-suggestions': (input: {
    id: string;
    candidates: Array<Record<string, unknown>>;
  }) => Promise<unknown>;
  'actualforge-payment-chain-clarification': (input: {
    id: string;
    caseId: string;
    resolution: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-transfers-overview': () => Promise<unknown>;
  'actualforge-transfer-suggestions': (input: {
    candidates: Array<Record<string, unknown>>;
  }) => Promise<unknown>;
  'actualforge-transfer-confirm': (input: { id: string }) => Promise<unknown>;
  'actualforge-transfer-remove': (input: { id: string }) => Promise<unknown>;
  'actualforge-transfer-clarification': (input: {
    caseId: string;
    resolution: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-credit-cards-list': () => Promise<unknown>;
  'actualforge-credit-card-upsert': (input: Record<string, unknown>) => Promise<unknown>;
  'actualforge-credit-card-remove': (input: { accountId: string }) => Promise<unknown>;
  'actualforge-credit-card-analysis': (input: {
    candidates: Array<Record<string, unknown>>;
  }) => Promise<unknown>;
  'actualforge-predictions-list': (input?: { status?: string }) => Promise<unknown>;
  'actualforge-prediction-create': (input: Record<string, unknown>) => Promise<unknown>;
  'actualforge-prediction-update': (input: {
    id: string;
    changes: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-prediction-remove': (input: { id: string }) => Promise<unknown>;
  'actualforge-forecast-generate': (input: Record<string, unknown>) => Promise<unknown>;
  'actualforge-clarifications-list': (input?: { status?: string }) => Promise<unknown>;
  'actualforge-clarification-resolve': (input: {
    id: string;
    resolution: Record<string, unknown>;
  }) => Promise<unknown>;
  'actualforge-airtable-status': () => Promise<unknown>;
  'actualforge-airtable-sync': () => Promise<unknown>;
};

export const app = createApp<ActualForgeHandlers>();

async function request(
  path: string,
  method: RequestMethod = 'GET',
  body?: unknown,
): Promise<unknown> {
  const server = getServer();
  if (!server) {
    throw new PostError('no-server');
  }

  const token = await asyncStorage.getItem('user-token');
  if (!token) {
    throw new PostError('unauthorized');
  }

  let response: Response;
  try {
    response = await fetch(server.BASE_SERVER + '/actualforge/api' + path, {
      method,
      headers: {
        accept: 'application/json',
        'X-ACTUAL-TOKEN': token,
        ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method !== 'GET' && body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    });
  } catch (error) {
    throw new PostError('network-failure', undefined, { cause: error });
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new PostError('parse-json', { meta: text });
  }

  if (!response.ok) {
    const reason =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : 'network-failure';
    throw new PostError(reason);
  }

  return data;
}

async function pushActualCoreBatches(
  dataset: ActualCoreDataset,
  records: ActualCoreRecord[],
  syncId: string,
): Promise<void> {
  for (const batch of chunk(records, 200)) {
    await request('/airtable/core-batch', 'POST', {
      dataset,
      records: batch,
      syncId,
    });
  }
}

async function syncActualCoreToAirtable() {
  const status = (await request('/airtable/status')) as {
    enabled?: boolean;
    configured?: boolean;
  };
  if (!status.enabled || !status.configured) {
    throw new PostError('airtable_bridge_not_configured');
  }

  const accounts = await db.all<{
    id: string;
    name: string;
    offbudget: number;
    closed: number;
    official_name: string | null;
    account_sync_source: string | null;
    last_sync: string | null;
    bank_name: string | null;
    tombstone: number;
    balance_minor: number | null;
    cleared_balance_minor: number | null;
  }>(`
    SELECT
      a.id,
      a.name,
      a.offbudget,
      a.closed,
      a.official_name,
      a.account_sync_source,
      a.last_sync,
      b.name AS bank_name,
      a.tombstone,
      COALESCE(bal.balance_minor, 0) AS balance_minor,
      COALESCE(bal.cleared_balance_minor, 0) AS cleared_balance_minor
    FROM accounts a
    LEFT JOIN banks b ON b.id = a.bank
    LEFT JOIN (
      SELECT
        account,
        SUM(CASE WHEN is_parent = 0 THEN amount ELSE 0 END) AS balance_minor,
        SUM(
          CASE
            WHEN is_parent = 0 AND cleared = 1 THEN amount
            ELSE 0
          END
        ) AS cleared_balance_minor
      FROM v_transactions
      GROUP BY account
    ) bal ON bal.account = a.id
    ORDER BY a.sort_order, a.name
  `);

  const accountRecords: ActualCoreRecord[] = accounts.map(account => ({
    id: account.id,
    name: account.name,
    type: account.offbudget ? 'offbudget' : 'onbudget',
    institution: account.bank_name,
    balanceMinor: account.balance_minor ?? 0,
    clearedBalanceMinor: account.cleared_balance_minor ?? 0,
    closed: Boolean(account.closed),
    offBudget: Boolean(account.offbudget),
    accountSyncSource: account.account_sync_source,
    lastSync: account.last_sync,
    deleted: Boolean(account.tombstone),
  }));

  const categories = await db.all<{
    id: string;
    name: string;
    is_income: number;
    group_id: string | null;
    group_name: string | null;
    hidden: number;
    tombstone: number;
  }>(`
    SELECT
      c.id,
      c.name,
      c.is_income,
      c.cat_group AS group_id,
      cg.name AS group_name,
      c.hidden,
      c.tombstone
    FROM categories c
    LEFT JOIN category_groups cg ON cg.id = c.cat_group
    ORDER BY c.sort_order, c.name
  `);

  const categoryRecords: ActualCoreRecord[] = categories.map(category => ({
    id: category.id,
    name: category.name,
    groupId: category.group_id,
    groupName: category.group_name,
    hidden: Boolean(category.hidden),
    isIncome: Boolean(category.is_income),
    deleted: Boolean(category.tombstone),
  }));

  const payees = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM payees WHERE tombstone = 0',
  );
  const payeeNames = new Map(payees.map(payee => [payee.id, payee.name]));

  const { data: activeSchedules } = await aqlQuery(
    q('schedules').select('*'),
  );
  const scheduleRecords: ActualCoreRecord[] = (
    activeSchedules as Array<Record<string, unknown>>
  ).map(schedule => {
    const actions = Array.isArray(schedule._actions)
      ? (schedule._actions as Array<Record<string, unknown>>)
      : [];
    const categoryAction = actions.find(
      action =>
        action.op === 'set' &&
        action.field === 'category' &&
        typeof action.value === 'string',
    );
    const amount =
      typeof schedule._amount === 'number' ? schedule._amount : null;
    const payeeId =
      typeof schedule._payee === 'string' ? schedule._payee : null;

    return {
      id: String(schedule.id),
      name:
        typeof schedule.name === 'string' && schedule.name
          ? schedule.name
          : 'Schedule',
      accountId:
        typeof schedule._account === 'string' ? schedule._account : null,
      payeeId,
      payeeName: payeeId ? payeeNames.get(payeeId) ?? null : null,
      categoryId:
        categoryAction && typeof categoryAction.value === 'string'
          ? categoryAction.value
          : null,
      amountMinor: amount,
      nextDate:
        typeof schedule.next_date === 'string' ? schedule.next_date : null,
      active: !Boolean(schedule.completed),
      completed: Boolean(schedule.completed),
      postsTransaction: Boolean(schedule.posts_transaction),
      rule: JSON.stringify({
        rule: schedule.rule ?? null,
        date: schedule._date ?? null,
        amount: schedule._amount ?? null,
        amountOp: schedule._amountOp ?? null,
        conditions: schedule._conditions ?? [],
        actions,
      }),
      deleted: Boolean(schedule.tombstone),
    };
  });

  const deletedSchedules = await db.all<{ id: string }>(
    'SELECT id FROM schedules WHERE tombstone = 1',
  );
  const activeScheduleIds = new Set(
    scheduleRecords.map(schedule => String(schedule.id)),
  );
  for (const deleted of deletedSchedules) {
    if (!activeScheduleIds.has(deleted.id)) {
      scheduleRecords.push({
        id: deleted.id,
        deleted: true,
        active: false,
        completed: true,
        postsTransaction: false,
      });
    }
  }

  const transactions = await db.all<TransactionSnapshotRow>(`
    SELECT
      v.id,
      v.is_parent,
      v.is_child,
      v.parent_id,
      v.account,
      v.category,
      v.payee,
      p.name AS payee_name,
      c.name AS category_name,
      v.amount,
      v.notes,
      v.date,
      v.imported_id,
      v.transfer_id,
      transfer.acct AS transfer_account_id,
      v.cleared,
      raw.reconciled,
      raw.schedule
    FROM v_transactions v
    JOIN transactions raw ON raw.id = v.id
    LEFT JOIN payees p ON p.id = v.payee
    LEFT JOIN categories c ON c.id = v.category
    LEFT JOIN transactions transfer ON transfer.id = v.transfer_id
    ORDER BY v.date, v.id
  `);

  const transactionRecords: ActualCoreRecord[] = transactions.map(
    transaction => ({
      id: transaction.id,
      accountId: transaction.account,
      date: transaction.date,
      amountMinor: transaction.amount,
      payeeId: transaction.payee,
      payeeName: transaction.payee_name,
      categoryId: transaction.category,
      categoryName: transaction.category_name,
      notes: transaction.notes,
      cleared: Boolean(transaction.cleared),
      reconciled: Boolean(transaction.reconciled),
      importedId: transaction.imported_id,
      transferId: transaction.transfer_id,
      transferAccountId: transaction.transfer_account_id,
      isTransfer: Boolean(transaction.transfer_id),
      isParent: Boolean(transaction.is_parent),
      isChild: Boolean(transaction.is_child),
      parentId: transaction.parent_id,
      scheduleId: transaction.schedule,
      deleted: false,
    }),
  );

  const deletedTransactions = await db.all<{ id: string }>(
    'SELECT id FROM transactions WHERE tombstone = 1',
  );
  transactionRecords.push(
    ...deletedTransactions.map(transaction => ({
      id: transaction.id,
      deleted: true,
    })),
  );

  const syncId = uuidv4();

  await pushActualCoreBatches('accounts', accountRecords, syncId);
  await pushActualCoreBatches('categories', categoryRecords, syncId);
  await pushActualCoreBatches('schedules', scheduleRecords, syncId);
  await pushActualCoreBatches('transactions', transactionRecords, syncId);

  return {
    accepted: true,
    counts: {
      accounts: accountRecords.length,
      categories: categoryRecords.length,
      schedules: scheduleRecords.length,
      transactions: transactionRecords.length,
    },
    status: await request('/airtable/status'),
  };
}

app.method('actualforge-airtable-status', () => request('/airtable/status'));
app.method('actualforge-airtable-sync', syncActualCoreToAirtable);

app.method('actualforge-overview', async () => {
  const [health, ready, status, capabilities] = await Promise.all([
    request('/engine/health'),
    request('/engine/ready'),
    request('/engine/status'),
    request('/engine/capabilities'),
  ]);
  return { health, ready, status, capabilities };
});

app.method('actualforge-contracts-list', () => request('/contracts'));

app.method('actualforge-contract-create', input =>
  request('/contracts', 'POST', input),
);

app.method('actualforge-contract-get', ({ id }) =>
  request(`/contracts/${encodeURIComponent(id)}`),
);

app.method('actualforge-contract-update', ({ id, changes }) =>
  request(`/contracts/${encodeURIComponent(id)}`, 'PATCH', changes),
);

app.method('actualforge-contract-link', ({ id, link }) =>
  request(`/contracts/${encodeURIComponent(id)}/links`, 'POST', link),
);

app.method('actualforge-contract-unlink', ({ id, linkId }) =>
  request(
    `/contracts/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`,
    'DELETE',
  ),
);

app.method('actualforge-contract-suggestions', ({ id, candidates }) =>
  request(
    `/contracts/${encodeURIComponent(id)}/suggestions`,
    'POST',
    { candidates },
  ),
);


app.method('actualforge-payment-chains-list', () =>
  request('/payment-chains'),
);

app.method('actualforge-payment-chain-create', input =>
  request('/payment-chains', 'POST', input),
);

app.method('actualforge-payment-chain-get', ({ id }) =>
  request(`/payment-chains/${encodeURIComponent(id)}`),
);

app.method('actualforge-payment-chain-link', ({ id, link }) =>
  request(`/payment-chains/${encodeURIComponent(id)}/links`, 'POST', link),
);

app.method('actualforge-payment-chain-unlink', ({ id, linkId }) =>
  request(
    `/payment-chains/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`,
    'DELETE',
  ),
);

app.method('actualforge-payment-chain-splits', ({ id, linkId, splits }) =>
  request(
    `/payment-chains/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}/splits`,
    'PATCH',
    { splits },
  ),
);

app.method('actualforge-payment-chain-suggestions', ({ id, candidates }) =>
  request(
    `/payment-chains/${encodeURIComponent(id)}/suggestions`,
    'POST',
    { candidates },
  ),
);

app.method(
  'actualforge-payment-chain-clarification',
  ({ id, caseId, resolution }) =>
    request(
      `/payment-chains/${encodeURIComponent(id)}/clarifications/${encodeURIComponent(caseId)}`,
      'PATCH',
      resolution,
    ),
);


app.method('actualforge-transfers-overview', () => request('/transfers'));

app.method('actualforge-transfer-suggestions', ({ candidates }) =>
  request('/transfers/suggestions', 'POST', { candidates }),
);

app.method('actualforge-transfer-confirm', ({ id }) =>
  request(`/transfers/matches/${encodeURIComponent(id)}`, 'PATCH', {}),
);

app.method('actualforge-transfer-remove', ({ id }) =>
  request(`/transfers/matches/${encodeURIComponent(id)}`, 'DELETE'),
);

app.method(
  'actualforge-transfer-clarification',
  ({ caseId, resolution }) =>
    request(
      `/transfers/clarifications/${encodeURIComponent(caseId)}`,
      'PATCH',
      resolution,
    ),
);

app.method('actualforge-credit-cards-list', () => request('/credit-cards'));

app.method('actualforge-credit-card-upsert', input =>
  request('/credit-cards', 'POST', input),
);

app.method('actualforge-credit-card-remove', ({ accountId }) =>
  request(`/credit-cards/${encodeURIComponent(accountId)}`, 'DELETE'),
);

app.method('actualforge-credit-card-analysis', ({ candidates }) =>
  request('/credit-cards/analyze', 'POST', { candidates }),
);


app.method('actualforge-predictions-list', input =>
  request(
    input?.status
      ? `/predictions?status=${encodeURIComponent(input.status)}`
      : '/predictions',
  ),
);

app.method('actualforge-prediction-create', input =>
  request('/predictions', 'POST', input),
);

app.method('actualforge-prediction-update', ({ id, changes }) =>
  request(`/predictions/${encodeURIComponent(id)}`, 'PATCH', changes),
);

app.method('actualforge-prediction-remove', ({ id }) =>
  request(`/predictions/${encodeURIComponent(id)}`, 'DELETE'),
);

app.method('actualforge-forecast-generate', input =>
  request('/forecast/generate', 'POST', input),
);

app.method('actualforge-clarifications-list', input =>
  request(
    input?.status
      ? `/clarifications?status=${encodeURIComponent(input.status)}`
      : '/clarifications',
  ),
);

app.method('actualforge-clarification-resolve', ({ id, resolution }) =>
  request(
    `/clarifications/${encodeURIComponent(id)}`,
    'PATCH',
    resolution,
  ),
);
