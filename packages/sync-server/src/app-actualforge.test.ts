import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createActualForgeHandlers } from './app-actualforge';

function createApp(
  financeEngineUrl: string,
  fetchImpl: typeof fetch,
): express.Express {
  const app = express();
  app.use(
    '/actualforge/api',
    createActualForgeHandlers({ financeEngineUrl, fetchImpl, timeoutMs: 100 }),
  );
  return app;
}

describe('ActualForge finance-engine bridge', () => {
  it('forwards only the fixed status endpoint to the configured engine', async () => {
    let requestedUrl = '';

    const fetchImpl: typeof fetch = async input => {
      requestedUrl = input.toString();
      return new Response(
        JSON.stringify({
          service: 'finance-engine',
          version: '0.1.0',
          schemaVersion: 1,
          persistence: 'sqlite',
          actualIntegration: {
            baseUrl: 'http://actualforge:5006',
            access: 'api-only',
            transactionStorage: 'reference-by-id',
            automaticTransactionMutation: false,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const response = await request(
      createApp('http://finance-engine:5010', fetchImpl),
    ).get('/actualforge/api/engine/status');

    expect(response.statusCode).toBe(200);
    expect(response.body.service).toBe('finance-engine');
    expect(requestedUrl).toBe('http://finance-engine:5010/api/v1/status');
  });

  it('returns 503 when the finance engine is not configured', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await request(createApp('', fetchImpl)).get(
      '/actualforge/api/engine/health',
    );

    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('finance_engine_not_configured');
  });

  it('does not behave as an open proxy', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await request(
      createApp('http://finance-engine:5010', fetchImpl),
    ).get('/actualforge/api/engine/arbitrary-url');

    expect(response.statusCode).toBe(404);
    expect(response.body.error).toBe('actualforge_endpoint_not_found');
  });

  it('returns a stable gateway error when the engine cannot be reached', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };

    const response = await request(
      createApp('http://finance-engine:5010', fetchImpl),
    ).get('/actualforge/api/engine/ready');

    expect(response.statusCode).toBe(502);
    expect(response.body.error).toBe('finance_engine_unavailable');
  });
});
