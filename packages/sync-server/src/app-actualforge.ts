import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { validateSession } from './util/validate-user';

const ENGINE_ENDPOINTS = {
  health: '/health',
  ready: '/ready',
  status: '/api/v1/status',
  capabilities: '/api/v1/capabilities',
} as const;

type EngineEndpoint = keyof typeof ENGINE_ENDPOINTS;

type ValidateSession = (
  req: Request,
  res: Response,
) => ReturnType<typeof validateSession>;

type CreateActualForgeHandlersOptions = {
  financeEngineUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  validateSessionFn?: ValidateSession;
};

function parseFinanceEngineUrl(value: string): URL | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

export function createActualForgeHandlers({
  financeEngineUrl,
  fetchImpl = fetch,
  timeoutMs = 3000,
  validateSessionFn = validateSession,
}: CreateActualForgeHandlersOptions): Router {
  const handlers = express.Router();
  const engineBaseUrl = parseFinanceEngineUrl(financeEngineUrl);

  handlers.use((req: Request, res: Response, next: NextFunction) => {
    const session = validateSessionFn(req, res);
    if (!session) return;
    res.locals.actualForgeSession = session;
    next();
  });

  async function forward(
    req: Request,
    res: Response,
    upstreamPath: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  ) {
    if (!engineBaseUrl) {
      res.status(503).json({ error: 'finance_engine_not_configured' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const target = new URL(upstreamPath, engineBaseUrl);
      const upstream = await fetchImpl(target, {
        method,
        headers: {
          accept: 'application/json',
          ...(method !== 'GET' && { 'content-type': 'application/json' }),
        },
        ...(method !== 'GET' && method !== 'DELETE'
          ? { body: JSON.stringify(req.body ?? {}) }
          : method === 'DELETE' && Object.keys(req.body ?? {}).length > 0
            ? { body: JSON.stringify(req.body) }
            : {}),
        signal: controller.signal,
      });

      const body = await upstream.text();
      res.status(upstream.status);
      res.set(
        'content-type',
        upstream.headers.get('content-type') ??
          'application/json; charset=utf-8',
      );
      res.set('cache-control', 'no-store');
      res.send(body);
    } catch {
      res.status(502).json({ error: 'finance_engine_unavailable' });
    } finally {
      clearTimeout(timeout);
    }
  }

  handlers.get('/engine/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint as EngineEndpoint;
    const upstreamPath = ENGINE_ENDPOINTS[endpoint];

    if (!upstreamPath) {
      res.status(404).json({ error: 'actualforge_endpoint_not_found' });
      return;
    }

    await forward(req, res, upstreamPath, 'GET');
  });

  handlers.get('/contracts', (req, res) =>
    forward(req, res, '/api/v1/contracts', 'GET'),
  );
  handlers.post('/contracts', (req, res) =>
    forward(req, res, '/api/v1/contracts', 'POST'),
  );

  handlers.get('/contracts/:contractId', (req, res) =>
    forward(
      req,
      res,
      `/api/v1/contracts/${encodeURIComponent(req.params.contractId)}`,
      'GET',
    ),
  );
  handlers.patch('/contracts/:contractId', (req, res) =>
    forward(
      req,
      res,
      `/api/v1/contracts/${encodeURIComponent(req.params.contractId)}`,
      'PATCH',
    ),
  );

  handlers.post('/contracts/:contractId/links', (req, res) =>
    forward(
      req,
      res,
      `/api/v1/contracts/${encodeURIComponent(req.params.contractId)}/links`,
      'POST',
    ),
  );

  handlers.delete('/contracts/:contractId/links/:linkId', (req, res) =>
    forward(
      req,
      res,
      `/api/v1/contracts/${encodeURIComponent(req.params.contractId)}/links/${encodeURIComponent(req.params.linkId)}`,
      'DELETE',
    ),
  );

  handlers.post('/contracts/:contractId/suggestions', (req, res) =>
    forward(
      req,
      res,
      `/api/v1/contracts/${encodeURIComponent(req.params.contractId)}/suggestions`,
      'POST',
    ),
  );

  return handlers;
}
