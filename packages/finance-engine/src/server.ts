import http from 'node:http';

import type { FinanceEngineConfig } from './config.js';
import {
  checkDatabase,
  getSchemaVersion,
  type FinanceDatabase,
} from './db.js';

export const FINANCE_ENGINE_VERSION = '0.1.0';

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

export function createFinanceEngineServer({
  config,
  db,
}: ServerDependencies): http.Server {
  return http.createServer((request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://finance-engine.local');

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
          contracts: 'schema-ready',
          paymentChains: 'schema-ready',
          transactionLinks: 'schema-ready',
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
  });
}
