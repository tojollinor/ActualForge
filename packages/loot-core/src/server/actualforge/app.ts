import * as asyncStorage from '#platform/server/asyncStorage';
import { fetch } from '#platform/server/fetch';
import { createApp } from '#server/app';
import { PostError } from '#server/errors';
import { getServer } from '#server/server-config';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
