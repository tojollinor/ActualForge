import http from 'node:http';

import type { FinanceEngineConfig } from './config.js';
import {
  confirmTransactionLink,
  ContractError,
  createContract,
  getContractDetail,
  listContracts,
  removeTransactionLink,
  suggestContractLinks,
  updateContract,
  type ContractInput,
  type TransactionCandidate,
} from './contracts.js';
import {
  checkDatabase,
  getSchemaVersion,
  type FinanceDatabase,
} from './db.js';

export const FINANCE_ENGINE_VERSION = '0.2.0';

interface ServerDependencies {
  config: FinanceEngineConfig;
  db: FinanceDatabase;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) {
      throw new ContractError('request_too_large', 413);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ContractError('invalid_json');
  }
}

function matchContractPath(pathname: string) {
  const linkMatch = pathname.match(
    /^\/api\/v1\/contracts\/([^/]+)\/links\/([^/]+)$/,
  );
  if (linkMatch) {
    return {
      kind: 'link' as const,
      contractId: decodeURIComponent(linkMatch[1]),
      linkId: decodeURIComponent(linkMatch[2]),
    };
  }

  const linksMatch = pathname.match(
    /^\/api\/v1\/contracts\/([^/]+)\/links$/,
  );
  if (linksMatch) {
    return {
      kind: 'links' as const,
      contractId: decodeURIComponent(linksMatch[1]),
    };
  }

  const suggestionsMatch = pathname.match(
    /^\/api\/v1\/contracts\/([^/]+)\/suggestions$/,
  );
  if (suggestionsMatch) {
    return {
      kind: 'suggestions' as const,
      contractId: decodeURIComponent(suggestionsMatch[1]),
    };
  }

  const contractMatch = pathname.match(/^\/api\/v1\/contracts\/([^/]+)$/);
  if (contractMatch) {
    return {
      kind: 'contract' as const,
      contractId: decodeURIComponent(contractMatch[1]),
    };
  }

  if (pathname === '/api/v1/contracts') {
    return { kind: 'contracts' as const };
  }

  return null;
}

async function handleContractsRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  db: FinanceDatabase,
  url: URL,
): Promise<boolean> {
  const route = matchContractPath(url.pathname);
  if (!route) return false;

  const method = request.method ?? 'GET';

  if (route.kind === 'contracts') {
    if (method === 'GET') {
      sendJson(response, 200, { contracts: listContracts(db) });
      return true;
    }

    if (method === 'POST') {
      const body = (await readJson(request)) as ContractInput;
      sendJson(response, 201, { contract: createContract(db, body) });
      return true;
    }
  }

  if (route.kind === 'contract') {
    if (method === 'GET') {
      sendJson(response, 200, getContractDetail(db, route.contractId));
      return true;
    }

    if (method === 'PATCH') {
      const body = (await readJson(request)) as Partial<ContractInput>;
      sendJson(response, 200, {
        contract: updateContract(db, route.contractId, body),
      });
      return true;
    }
  }

  if (route.kind === 'links' && method === 'POST') {
    const body = (await readJson(request)) as {
      actualTransactionId: string;
      amountMinor?: number | null;
      date?: string | null;
      linkType?: string;
      confidence?: number | null;
      metadata?: Record<string, unknown> | null;
    };
    sendJson(response, 200, {
      link: confirmTransactionLink(db, route.contractId, body),
      detail: getContractDetail(db, route.contractId),
    });
    return true;
  }

  if (route.kind === 'link' && method === 'DELETE') {
    removeTransactionLink(db, route.contractId, route.linkId);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (route.kind === 'suggestions' && method === 'POST') {
    const body = (await readJson(request)) as {
      candidates?: TransactionCandidate[];
    };
    sendJson(response, 200, {
      suggestions: suggestContractLinks(
        db,
        route.contractId,
        body.candidates ?? [],
      ),
      detail: getContractDetail(db, route.contractId),
    });
    return true;
  }

  response.setHeader(
    'allow',
    route.kind === 'contracts'
      ? 'GET, POST'
      : route.kind === 'contract'
        ? 'GET, PATCH'
        : route.kind === 'links'
          ? 'POST'
          : route.kind === 'link'
            ? 'DELETE'
            : 'POST',
  );
  sendJson(response, 405, { error: 'method_not_allowed' });
  return true;
}

export function createFinanceEngineServer({
  config,
  db,
}: ServerDependencies): http.Server {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://finance-engine.local');

    try {
      if (await handleContractsRequest(request, response, db, url)) {
        return;
      }

      const method = request.method ?? 'GET';
      if (method !== 'GET') {
        response.setHeader('allow', 'GET');
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          service: 'finance-engine',
          version: FINANCE_ENGINE_VERSION,
        });
        return;
      }

      if (url.pathname === '/ready') {
        try {
          const databaseReady = checkDatabase(db);
          sendJson(response, databaseReady ? 200 : 503, {
            status: databaseReady ? 'ready' : 'not_ready',
            service: 'finance-engine',
            schemaVersion: getSchemaVersion(db),
          });
        } catch {
          sendJson(response, 503, {
            status: 'not_ready',
            service: 'finance-engine',
          });
        }
        return;
      }

      if (url.pathname === '/api/v1/status') {
        sendJson(response, 200, {
          service: 'finance-engine',
          version: FINANCE_ENGINE_VERSION,
          schemaVersion: getSchemaVersion(db),
          persistence: 'sqlite',
          actualIntegration: {
            baseUrl: config.actualBaseUrl,
            access: 'api-only',
            transactionStorage: 'reference-by-id',
            automaticTransactionMutation: false,
          },
        });
        return;
      }

      if (url.pathname === '/api/v1/capabilities') {
        sendJson(response, 200, {
          domains: {
            contracts: 'active',
            paymentChains: 'schema-ready',
            transactionLinks: 'active',
            transferMatches: 'schema-ready',
            clarificationCases: 'schema-ready',
            predictions: 'schema-ready',
            merchantMappings: 'schema-ready',
            recognitionRules: 'schema-ready',
          },
          behavior: {
            ambiguousMatchesRequireClarification: true,
            originalActualTransactionsRemainAuthoritative: true,
          },
        });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof ContractError) {
        sendJson(response, error.statusCode, { error: error.code });
        return;
      }

      console.error('finance-engine request failed', error);
      sendJson(response, 500, { error: 'internal_error' });
    }
  });
}
