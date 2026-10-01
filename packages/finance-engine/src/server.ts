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
import {
  confirmPaymentChainLink,
  createPaymentChain,
  getPaymentChainDetail,
  listPaymentChains,
  removePaymentChainLink,
  replacePaymentChainSplits,
  resolveClarificationCase,
  suggestPaymentChainLinks,
  type PaymentChainInput,
  type PaymentRole,
  type TransactionSplitInput,
} from './payment-chains.js';
import {
  analyzeCreditCards,
  confirmProposedTransferMatch,
  confirmTransferMatch,
  getTransferOverview,
  listCreditCardProfiles,
  listTransferMatches,
  removeCreditCardProfile,
  removeTransferMatch,
  resolveTransferClarification,
  suggestTransferMatches,
  upsertCreditCardProfile,
  type CreditCardProfileInput,
  type TransferCandidate,
  type TransferMatchKind,
} from './transfers.js';

export const FINANCE_ENGINE_VERSION = '0.4.0';

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


function matchPaymentChainPath(pathname: string) {
  const clarification = pathname.match(
    /^\/api\/v1\/payment-chains\/([^/]+)\/clarifications\/([^/]+)$/,
  );
  if (clarification) {
    return {
      kind: 'clarification' as const,
      chainId: decodeURIComponent(clarification[1]),
      caseId: decodeURIComponent(clarification[2]),
    };
  }

  const splits = pathname.match(
    /^\/api\/v1\/payment-chains\/([^/]+)\/links\/([^/]+)\/splits$/,
  );
  if (splits) {
    return {
      kind: 'splits' as const,
      chainId: decodeURIComponent(splits[1]),
      linkId: decodeURIComponent(splits[2]),
    };
  }

  const link = pathname.match(
    /^\/api\/v1\/payment-chains\/([^/]+)\/links\/([^/]+)$/,
  );
  if (link) {
    return {
      kind: 'link' as const,
      chainId: decodeURIComponent(link[1]),
      linkId: decodeURIComponent(link[2]),
    };
  }

  const links = pathname.match(
    /^\/api\/v1\/payment-chains\/([^/]+)\/links$/,
  );
  if (links) {
    return {
      kind: 'links' as const,
      chainId: decodeURIComponent(links[1]),
    };
  }

  const suggestions = pathname.match(
    /^\/api\/v1\/payment-chains\/([^/]+)\/suggestions$/,
  );
  if (suggestions) {
    return {
      kind: 'suggestions' as const,
      chainId: decodeURIComponent(suggestions[1]),
    };
  }

  const chain = pathname.match(/^\/api\/v1\/payment-chains\/([^/]+)$/);
  if (chain) {
    return {
      kind: 'chain' as const,
      chainId: decodeURIComponent(chain[1]),
    };
  }

  if (pathname === '/api/v1/payment-chains') {
    return { kind: 'chains' as const };
  }

  return null;
}

async function handlePaymentChainsRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  db: FinanceDatabase,
  url: URL,
): Promise<boolean> {
  const route = matchPaymentChainPath(url.pathname);
  if (!route) return false;
  const method = request.method ?? 'GET';

  if (route.kind === 'chains') {
    if (method === 'GET') {
      sendJson(response, 200, {
        paymentChains: listPaymentChains(
          db,
          url.searchParams.get('contractId'),
        ),
      });
      return true;
    }

    if (method === 'POST') {
      const body = (await readJson(request)) as PaymentChainInput;
      sendJson(response, 201, { paymentChain: createPaymentChain(db, body) });
      return true;
    }
  }

  if (route.kind === 'chain' && method === 'GET') {
    sendJson(response, 200, getPaymentChainDetail(db, route.chainId));
    return true;
  }

  if (route.kind === 'links' && method === 'POST') {
    const body = (await readJson(request)) as {
      actualTransactionId: string;
      role: PaymentRole;
      amountMinor: number;
      date: string;
      confidence?: number | null;
      metadata?: Record<string, unknown> | null;
      splits?: TransactionSplitInput[];
    };
    confirmPaymentChainLink(db, route.chainId, body);
    sendJson(response, 200, getPaymentChainDetail(db, route.chainId));
    return true;
  }

  if (route.kind === 'link' && method === 'DELETE') {
    removePaymentChainLink(db, route.chainId, route.linkId);
    sendJson(response, 200, getPaymentChainDetail(db, route.chainId));
    return true;
  }

  if (route.kind === 'splits' && method === 'PATCH') {
    const body = (await readJson(request)) as { splits?: TransactionSplitInput[] };
    replacePaymentChainSplits(
      db,
      route.chainId,
      route.linkId,
      body.splits ?? [],
    );
    sendJson(response, 200, getPaymentChainDetail(db, route.chainId));
    return true;
  }

  if (route.kind === 'suggestions' && method === 'POST') {
    const body = (await readJson(request)) as {
      candidates?: TransactionCandidate[];
    };
    sendJson(response, 200, {
      suggestions: suggestPaymentChainLinks(
        db,
        route.chainId,
        body.candidates ?? [],
      ),
      detail: getPaymentChainDetail(db, route.chainId),
    });
    return true;
  }

  if (route.kind === 'clarification' && method === 'PATCH') {
    const body = (await readJson(request)) as
      | { action: 'dismiss' }
      | {
          action: 'confirm';
          role: PaymentRole;
          amountMinor: number;
          date: string;
          splits?: TransactionSplitInput[];
        };
    resolveClarificationCase(db, route.chainId, route.caseId, body);
    sendJson(response, 200, getPaymentChainDetail(db, route.chainId));
    return true;
  }

  response.setHeader(
    'allow',
    route.kind === 'chains'
      ? 'GET, POST'
      : route.kind === 'chain'
        ? 'GET'
        : route.kind === 'links'
          ? 'POST'
          : route.kind === 'link'
            ? 'DELETE'
            : route.kind === 'splits' || route.kind === 'clarification'
              ? 'PATCH'
              : 'POST',
  );
  sendJson(response, 405, { error: 'method_not_allowed' });
  return true;
}


function matchTransferPath(pathname: string) {
  const clarification = pathname.match(
    /^\/api\/v1\/transfers\/clarifications\/([^/]+)$/,
  );
  if (clarification) {
    return {
      kind: 'clarification' as const,
      caseId: decodeURIComponent(clarification[1]),
    };
  }

  const match = pathname.match(/^\/api\/v1\/transfers\/matches\/([^/]+)$/);
  if (match) {
    return {
      kind: 'match' as const,
      matchId: decodeURIComponent(match[1]),
    };
  }

  if (pathname === '/api/v1/credit-cards/analyze') {
    return { kind: 'credit-card-analysis' as const };
  }

  const card = pathname.match(/^\/api\/v1\/credit-cards\/([^/]+)$/);
  if (card) {
    return {
      kind: 'credit-card' as const,
      accountId: decodeURIComponent(card[1]),
    };
  }

  if (pathname === '/api/v1/transfers') {
    return { kind: 'transfers' as const };
  }
  if (pathname === '/api/v1/transfers/suggestions') {
    return { kind: 'suggestions' as const };
  }
  if (pathname === '/api/v1/transfers/matches') {
    return { kind: 'matches' as const };
  }
  if (pathname === '/api/v1/credit-cards') {
    return { kind: 'credit-cards' as const };
  }
  return null;
}

async function handleTransfersRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  db: FinanceDatabase,
  url: URL,
): Promise<boolean> {
  const route = matchTransferPath(url.pathname);
  if (!route) return false;
  const method = request.method ?? 'GET';

  if (route.kind === 'transfers' && method === 'GET') {
    sendJson(response, 200, getTransferOverview(db));
    return true;
  }

  if (route.kind === 'suggestions' && method === 'POST') {
    const body = (await readJson(request)) as {
      candidates?: TransferCandidate[];
    };
    sendJson(
      response,
      200,
      suggestTransferMatches(db, body.candidates ?? []),
    );
    return true;
  }

  if (route.kind === 'matches') {
    if (method === 'GET') {
      sendJson(response, 200, { matches: listTransferMatches(db) });
      return true;
    }

    if (method === 'POST') {
      const body = (await readJson(request)) as {
        source: TransferCandidate;
        target: TransferCandidate;
        kind?: TransferMatchKind;
        confidence?: number;
      };
      sendJson(response, 201, {
        match: confirmTransferMatch(db, body),
        overview: getTransferOverview(db),
      });
      return true;
    }
  }

  if (route.kind === 'match') {
    if (method === 'PATCH') {
      sendJson(response, 200, {
        match: confirmProposedTransferMatch(db, route.matchId),
        overview: getTransferOverview(db),
      });
      return true;
    }

    if (method === 'DELETE') {
      removeTransferMatch(db, route.matchId);
      sendJson(response, 200, getTransferOverview(db));
      return true;
    }
  }

  if (route.kind === 'clarification' && method === 'PATCH') {
    const body = (await readJson(request)) as
      | { action: 'dismiss' }
      | { action: 'confirm'; kind?: TransferMatchKind };
    resolveTransferClarification(db, route.caseId, body);
    sendJson(response, 200, getTransferOverview(db));
    return true;
  }

  if (route.kind === 'credit-cards') {
    if (method === 'GET') {
      sendJson(response, 200, { creditCards: listCreditCardProfiles(db) });
      return true;
    }

    if (method === 'POST') {
      const body = (await readJson(request)) as CreditCardProfileInput;
      sendJson(response, 201, {
        creditCard: upsertCreditCardProfile(db, body),
      });
      return true;
    }
  }

  if (route.kind === 'credit-card') {
    if (method === 'PATCH') {
      const body = (await readJson(request)) as Omit<
        CreditCardProfileInput,
        'actualAccountId'
      >;
      sendJson(response, 200, {
        creditCard: upsertCreditCardProfile(db, {
          ...body,
          actualAccountId: route.accountId,
        }),
      });
      return true;
    }

    if (method === 'DELETE') {
      removeCreditCardProfile(db, route.accountId);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (route.kind === 'credit-card-analysis' && method === 'POST') {
    const body = (await readJson(request)) as {
      candidates?: TransferCandidate[];
    };
    sendJson(response, 200, {
      creditCards: analyzeCreditCards(db, body.candidates ?? []),
    });
    return true;
  }

  response.setHeader(
    'allow',
    route.kind === 'transfers'
      ? 'GET'
      : route.kind === 'suggestions'
        ? 'POST'
        : route.kind === 'matches'
          ? 'GET, POST'
          : route.kind === 'match' || route.kind === 'clarification'
            ? 'PATCH, DELETE'
            : route.kind === 'credit-cards'
              ? 'GET, POST'
              : route.kind === 'credit-card'
                ? 'PATCH, DELETE'
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

      if (await handlePaymentChainsRequest(request, response, db, url)) {
        return;
      }

      if (await handleTransfersRequest(request, response, db, url)) {
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
            paymentChains: 'active',
            transactionLinks: 'active',
            transactionSplits: 'active',
            transferMatches: 'active',
            creditCards: 'active',
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
