import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { redis, closeRedis } from '../../lib/redis';

const app = createApp();

let admin = '';
let accountant = '';
let trialEntryId = '';

const SYSTEM = {
  inventoryId: '',
  apId: '',
  revenueId: '',
  cogsId: '',
};

beforeAll(async () => {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);

  const a = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@acme.test', password: 'Passw0rd!' });
  admin = a.body.accessToken;
  const b = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'accountant@acme.test', password: 'Passw0rd!' });
  accountant = b.body.accessToken;

  const accounts = await request(app).get('/api/v1/accounts').set('authorization', `Bearer ${admin}`);
  for (const acc of accounts.body) {
    if (acc.accountCode === '1200') SYSTEM.inventoryId = acc.accountId;
    if (acc.accountCode === '2000') SYSTEM.apId = acc.accountId;
    if (acc.accountCode === '4000') SYSTEM.revenueId = acc.accountId;
    if (acc.accountCode === '5000') SYSTEM.cogsId = acc.accountId;
  }
});

afterAll(async () => {
  // Leave the dev dataset clean: void anything the tests posted.
  if (trialEntryId) {
    await request(app).post(`/api/v1/journals/${trialEntryId}/void`).set(auth(admin));
  }
  await prisma.$disconnect();
  closeRedis();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const balancedLines = () => [
  { accountId: SYSTEM.inventoryId, entryType: 'DEBIT' as const, amount: 225 },
  { accountId: SYSTEM.apId, entryType: 'CREDIT' as const, amount: 225 },
];

describe('journals lifecycle', () => {
  let entryId = '';

  it('creates a DRAFT entry with a sequential number', async () => {
    const res = await request(app)
      .post('/api/v1/journals')
      .set(auth(admin))
      .send({ entryDate: '2026-03-01', lines: balancedLines() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.entryNumber).toMatch(/^JE-\d{4}$/);
    expect(res.body.totalDebit).toBe(225);
    expect(res.body.totalCredit).toBe(225);
    entryId = res.body.entryId;
  });

  it('rejects an unbalanced post', async () => {
    const created = await request(app)
      .post('/api/v1/journals')
      .set(auth(admin))
      .send({
        entryDate: '2026-03-01',
        lines: [
          { accountId: SYSTEM.inventoryId, entryType: 'DEBIT', amount: 100 },
          { accountId: SYSTEM.apId, entryType: 'CREDIT', amount: 90 },
        ],
      });
    const res = await request(app)
      .post(`/api/v1/journals/${created.body.entryId}/post`)
      .set(auth(admin));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('JOURNAL_UNBALANCED');
    // clean up the bad draft
    await request(app).post(`/api/v1/journals/${created.body.entryId}/void`).set(auth(admin));
  });

  it('rejects editing a POSTED entry but allows voiding it', async () => {
    const posted = await request(app).post(`/api/v1/journals/${entryId}/post`).set(auth(admin));
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.postedAt).toBeTruthy();

    const edit = await request(app)
      .patch(`/api/v1/journals/${entryId}`)
      .set(auth(admin))
      .send({ entryDate: '2026-03-02' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('ENTRY_IMMUTABLE');

    const voided = await request(app).post(`/api/v1/journals/${entryId}/void`).set(auth(admin));
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('VOIDED');

    const again = await request(app).post(`/api/v1/journals/${entryId}/void`).set(auth(admin));
    expect(again.status).toBe(409);
  });

  it('trial balance sums posted entries by account', async () => {
    const before = await request(app)
      .get('/api/v1/reports/trial-balance')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(auth(accountant));
    const beforeDebit =
      before.body.find((r: { accountCode: string }) => r.accountCode === '1200')?.debit ?? 0;

    const created = await request(app)
      .post('/api/v1/journals')
      .set(auth(accountant))
      .send({
        entryDate: '2026-03-05',
        lines: [
          { accountId: SYSTEM.inventoryId, entryType: 'DEBIT', amount: 50 },
          { accountId: SYSTEM.apId, entryType: 'CREDIT', amount: 50 },
        ],
      });
    trialEntryId = created.body.entryId;
    await request(app).post(`/api/v1/journals/${trialEntryId}/post`).set(auth(accountant));

    const res = await request(app)
      .get('/api/v1/reports/trial-balance')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(auth(accountant));
    expect(res.status).toBe(200);
    const inventory = res.body.find((r: { accountCode: string }) => r.accountCode === '1200');
    expect(inventory.debit).toBe(beforeDebit + 50); // only the new POSTED entry counts
    expect(inventory.credit).toBe(0);
  });

  it('storekeeper cannot create journals', async () => {
    const store = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'store@acme.test', password: 'Passw0rd!' });
    const res = await request(app)
      .post('/api/v1/journals')
      .set(auth(store.body.accessToken))
      .send({ entryDate: '2026-03-01', lines: balancedLines() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
