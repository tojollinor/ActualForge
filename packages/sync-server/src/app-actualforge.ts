import express from 'express';
import type { Router } from 'express';

const ENGINE_ENDPOINTS = {
  health: '/health',
  ready: '/ready',
  status: '/api/v1/status',
  capabilities: '/api/v1/capabilities',
} as const;

type EngineEndpoint = keyof typeof ENGINE_ENDPOINTS;

type CreateActualForgeHandlersOptions = {
  financeEngineUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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
}: CreateActualForgeHandlersOptions): Router {
  const handlers = express.Router();
  const engineBaseUrl = parseFinanceEngineUrl(financeEngineUrl);

  handlers.get('/engine/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint as EngineEndpoint;
    const upstreamPath = ENGINE_ENDPOINTS[endpoint];

    if (!upstreamPath) {
      res.status(404).json({ error: 'actualforge_endpoint_not_found' });
      return;
    }

    if (!engineBaseUrl) {
      res.status(503).json({ error: 'finance_engine_not_configured' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const target = new URL(upstreamPath, engineBaseUrl);
      const upstream = await fetchImpl(target, {
        method: 'GET',
        headers: { accept: 'application/json' },
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
  });

  return handlers;
}
