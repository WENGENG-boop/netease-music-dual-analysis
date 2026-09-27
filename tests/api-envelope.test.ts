import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const originalCorsOrigin = process.env.CORS_ORIGIN;

afterEach(() => {
  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;
});

describe('phase 0 API envelope and request guardrails', () => {
  it('returns successful responses with requestId', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.json()).toMatchObject({ success: true, requestId: expect.any(String), data: { status: 'healthy' } });
  });

  it('returns validation failures with the standard error envelope', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {} });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      requestId: expect.any(String),
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    });
  });

  it('rejects unsafe API origins when an origin allowlist is configured', async () => {
    process.env.CORS_ORIGIN = 'https://allowed.example';
    const app = await buildApp({ logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'https://evil.example' },
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_ORIGIN' },
    });
  });
});
