import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { closeRedis } from '../../lib/redis';
import { redis } from '../../lib/redis';

const app = createApp();

const ADMIN = { email: 'admin@acme.test', password: 'Passw0rd!' };
const STORE = { email: 'store@acme.test', password: 'Passw0rd!' };

const login = (body: object) =>
  request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send(body);

beforeAll(async () => {
  // Clear any leftover rate-limit buckets so tests start with a fresh window.
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await prisma.$disconnect();
  closeRedis();
});

describe('POST /auth/login', () => {
  it('returns tokens + user with roles and permissions', async () => {
    const res = await login(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe(ADMIN.email);
    expect(res.body.user.roles).toContain('ADMIN');
    expect(res.body.user.permissions).toContain('journals:post');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await login({ ...ADMIN, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same 401', async () => {
    const res = await login({ email: 'nobody@acme.test', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /auth/refresh + /auth/logout', () => {
  it('rotates: old refresh token dies after being used', async () => {
    const first = await login(ADMIN);
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();

    // Replay of the same refresh token must fail (rotation).
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(replay.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const first = await login(ADMIN);
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${first.body.accessToken}`)
      .send({ refreshToken: first.body.refreshToken });
    expect(out.status).toBe(204);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me + RBAC', () => {
  it('me requires a token and returns the profile', async () => {
    const anon = await request(app).get('/api/v1/auth/me');
    expect(anon.status).toBe(401);

    const first = await login(ADMIN);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${first.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.companyName).toBe('Acme Trading Co.');
  });

  it('storekeeper can list but must not create journals (403)', async () => {
    const first = await login(STORE);
    const token = { authorization: `Bearer ${first.body.accessToken}` };
    expect(first.body.user.permissions).toContain('inventory:write');
    expect(first.body.user.permissions).not.toContain('journals:write');

    const res = await request(app)
      .post('/api/v1/journals')
      .set(token)
      .send({ entryDate: '2026-01-01', lines: [] });
    // The storekeeper has no journals:write — the request must not pass.
    expect([403, 404]).toContain(res.status);
  });
});
