import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { DataError } from '../errors';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '@/auth/tokenStorage';

/**
 * Interceptor behavior tests driven through a stub axios adapter — no network.
 * They prove the three transport invariants: bearer attachment, error-envelope
 * mapping, and the single-flight 401 → refresh → retry round-trip.
 */

const TOKEN_PAIR = (access: string, refresh: string) => ({
  accessToken: access,
  refreshToken: refresh,
  user: {
    userId: 'u1',
    companyId: 'c1',
    companyName: 'Acme',
    email: 'admin@acme.test',
    fullName: 'Admin',
    roles: ['ADMIN'],
    permissions: ['accounts:read'],
  },
});

type Handler = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

/** Resolve with a JSON body; failing statuses must throw via `reject` instead. */
const reply = (data: unknown, status = 200): Handler => async (config) => ({
  data,
  status,
  statusText: String(status),
  headers: {},
  config,
});

/** Reject like a real axios adapter does for a non-2xx response. */
function reject(
  config: InternalAxiosRequestConfig,
  status: number,
  body: unknown,
): Promise<never> {
  const response: AxiosResponse = {
    data: body,
    status,
    statusText: String(status),
    headers: {},
    config,
  };
  throw new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, undefined, response);
}

function makeClient(handler: Handler) {
  return createApiClient({ baseURL: '/api/v1', adapter: async (config) => handler(config) });
}

const envelope = (code: string, message: string) => ({ error: { code, message } });

describe('http api client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('attaches the stored access token as a bearer header', async () => {
    saveTokens(TOKEN_PAIR('access-1', 'refresh-1'));
    const seen: string[] = [];
    const { client } = makeClient(async (config) => {
      seen.push(String(config.headers?.Authorization));
      return reply([])(config);
    });

    await client.get('/accounts');

    expect(seen).toEqual(['Bearer access-1']);
  });

  it('maps the API error envelope onto DataError', async () => {
    const { client } = makeClient(async (config) =>
      reject(config, 409, envelope('DUPLICATE', 'SKU WIDGET-1 already exists')),
    );

    await expect(client.post('/products', {})).rejects.toMatchObject({
      name: 'DataError',
      code: 'DUPLICATE',
      status: 409,
      message: 'SKU WIDGET-1 already exists',
    } satisfies Partial<DataError>);
  });

  it('reports network failures without a response', async () => {
    const { client } = makeClient(async (config) => {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
    });

    await expect(client.get('/accounts')).rejects.toMatchObject({
      name: 'DataError',
      code: 'NETWORK_ERROR',
      status: 0,
    } satisfies Partial<DataError>);
  });

  it('refreshes once and retries after a 401', async () => {
    saveTokens(TOKEN_PAIR('access-1', 'refresh-1'));
    const calls: { url: string; auth?: string }[] = [];
    const { client } = makeClient(async (config) => {
      const url = String(config.url);
      calls.push({ url, auth: String(config.headers?.Authorization ?? '') });
      if (url === '/auth/refresh') return reply(TOKEN_PAIR('access-2', 'refresh-2'))(config);
      if (calls.filter((c) => c.url === '/accounts').length === 1) {
        return reject(config, 401, envelope('UNAUTHORIZED', 'Token expired'));
      }
      return reply([{ accountId: 'a1' }])(config);
    });

    const accounts = await client.get('/accounts');

    expect(accounts.data).toEqual([{ accountId: 'a1' }]);
    expect(calls.map((c) => c.url)).toEqual(['/accounts', '/auth/refresh', '/accounts']);
    expect(calls[2].auth).toBe('Bearer access-2');
    expect(getAccessToken()).toBe('access-2');
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('dedupes concurrent 401s into one refresh', async () => {
    saveTokens(TOKEN_PAIR('access-1', 'refresh-1'));
    let refreshCount = 0;
    let accountCalls = 0;
    const { client } = makeClient(async (config) => {
      const url = String(config.url);
      if (url === '/auth/refresh') {
        refreshCount += 1;
        return reply(TOKEN_PAIR('access-2', 'refresh-2'))(config);
      }
      accountCalls += 1;
      if (accountCalls <= 2) return reject(config, 401, envelope('UNAUTHORIZED', 'Token expired'));
      return reply([])(config);
    });

    const [first, second] = await Promise.all([
      client.get('/accounts'),
      client.get('/warehouses'),
    ]);

    expect(first.data).toEqual([]);
    expect(second.data).toEqual([]);
    expect(refreshCount).toBe(1);
  });

  it('clears the session and surfaces 401 when the refresh token is dead', async () => {
    saveTokens(TOKEN_PAIR('access-1', 'refresh-1'));
    const { client } = makeClient(async (config) => {
      if (String(config.url) === '/auth/refresh') {
        return reject(config, 401, envelope('UNAUTHORIZED', 'Refresh token was revoked'));
      }
      return reject(config, 401, envelope('UNAUTHORIZED', 'Token expired'));
    });

    await expect(client.get('/accounts')).rejects.toMatchObject({
      name: 'DataError',
      status: 401,
    } satisfies Partial<DataError>);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('does not attempt a refresh for login failures', async () => {
    let refreshCount = 0;
    const { client } = makeClient(async (config) => {
      if (String(config.url) === '/auth/refresh') {
        refreshCount += 1;
        return reply(TOKEN_PAIR('access-2', 'refresh-2'))(config);
      }
      return reject(config, 401, envelope('INVALID_CREDENTIALS', 'Invalid email or password'));
    });

    await expect(client.post('/auth/login', {})).rejects.toMatchObject({
      name: 'DataError',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    } satisfies Partial<DataError>);
    expect(refreshCount).toBe(0);
  });

  it('fails fast on a 401 when no refresh token is stored', async () => {
    clearTokens();
    let refreshCount = 0;
    const { client } = makeClient(async (config) => {
      if (String(config.url) === '/auth/refresh') refreshCount += 1;
      return reject(config, 401, envelope('UNAUTHORIZED', 'Missing bearer token'));
    });

    await expect(client.get('/accounts')).rejects.toMatchObject({
      name: 'DataError',
      status: 401,
    } satisfies Partial<DataError>);
    expect(refreshCount).toBe(0);
  });
});
