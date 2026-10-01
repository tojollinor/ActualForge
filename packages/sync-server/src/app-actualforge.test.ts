import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createActualForgeHandlers } from './app-actualforge';

function createApp(
  financeEngineUrl: string,
  fetchImpl: typeof fetch,
  authenticated = true,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/actualforge/api',
    createActualForgeHandlers({
      financeEngineUrl,
      fetchImpl,
      timeoutMs: 100,
      validateSessionFn: (_req, res) => {
        if (!authenticated) {
          res.status(401).json({ error: 'unauthorized' });
          return null;
        }
        return { user_id: 'test-user' } as never;
      },
    }),
  );
  return app;
}

describe('ActualForge finance-engine bridge', () => {
  it('requires an authenticated Actual session', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch should not be called');
    };

    const response = await request(
      createApp('http://finance-engine:5010', fetchImpl, false),
    ).get('/actualforge/api/contracts');

    expect(response.statusCode).toBe(401);
  });

  it('forwards the fixed status endpoint', async () => {
    let requestedUrl = '';

    const fetchImpl: typeof fetch = async input => {
      requestedUrl = input.toString();
      return new Response(
        JSON.stringify({
          service: 'finance-engine',
          version: '0.2.0',
          schemaVersion: 2,
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

  it('forwards contract writes only to fixed contract paths', async () => {
    let method = '';
    let requestedUrl = '';
    let payload = '';

    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = input.toString();
      method = init?.method ?? '';
      payload = String(init?.body ?? '');
      return new Response(JSON.stringify({ contract: { id: 'contract-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const response = await request(
      createApp('http://finance-engine:5010', fetchImpl),
    )
      .post('/actualforge/api/contracts')
      .send({ title: 'Internet' });

    expect(response.statusCode).toBe(201);
    expect(method).toBe('POST');
    expect(requestedUrl).toBe('http://finance-engine:5010/api/v1/contracts');
    expect(JSON.parse(payload)).toEqual({ title: 'Internet' });
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
});
