import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Decimal } from '@erp/shared';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { redis, closeRedis } from '../../lib/redis';

const app = createApp();

let admin = '';
let accountant = '';
let trialEntryId = '';
let companyId = '';
const foreign = { companyId: randomUUID(), accountId: randomUUID() };

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
    companyId = acc.companyId;
  }

  // A second tenant's account proves line validation is company-scoped.
  await prisma.company.create({ data: { companyId: foreign.companyId, name: 'Foreign Co.' } });
  await prisma.chartOfAccount.create({
    data: {
      accountId: foreign.accountId,
      companyId: foreign.companyId,
      accountCode: '9000',
      accountName: 'Foreign account',
      accountType: 'ASSET',
    },
  });
});

afterAll(async () => {
  // Posted test entries (and their reversals) stay in the ledger; balance
  // assertions compare before/after so repeated runs remain valid.
  await prisma.chartOfAccount.deleteMany({ where: { accountId: foreign.accountId } });
  await prisma.company.deleteMany({ where: { companyId: foreign.companyId } });
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
    // A draft is voided in place (nothing was ever posted).
    const voided = await request(app)
      .post(`/api/v1/journals/${created.body.entryId}/void`)
      .set(auth(admin));
    expect(voided.body.status).toBe('VOIDED');
    expect(voided.body.reversedByEntryId).toBeNull();
  });

  it('keeps a POSTED entry and posts a mirror reversal when voided', async () => {
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

    // History must not move: capture the original period before reversing.
    const march = () =>
      request(app)
        .get('/api/v1/reports/trial-balance')
        .query({ from: '2026-03-01', to: '2026-03-01' })
        .set(auth(admin));
    const marchBefore = await march();

    const voided = await request(app).post(`/api/v1/journals/${entryId}/void`).set(auth(admin));
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('POSTED');
    expect(voided.body.reversedByEntryId).toBeTruthy();

    const marchAfter = await march();
    expect(marchAfter.body).toEqual(marchBefore.body);

    const reversal = await request(app)
      .get(`/api/v1/journals/${voided.body.reversedByEntryId}`)
      .set(auth(admin));
    expect(reversal.status).toBe(200);
    expect(reversal.body.status).toBe('POSTED');
    expect(reversal.body.referenceType).toBe('REVERSAL');
    expect(reversal.body.referenceId).toBe(entryId);
    expect(reversal.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: SYSTEM.inventoryId, entryType: 'CREDIT', amount: 225 }),
        expect.objectContaining({ accountId: SYSTEM.apId, entryType: 'DEBIT', amount: 225 }),
      ]),
    );

    const list = await request(app).get('/api/v1/journals').set(auth(admin));
    const original = list.body.find((e: { entryId: string }) => e.entryId === entryId);
    expect(original.reversedByEntryId).toBe(voided.body.reversedByEntryId);

    const again = await request(app).post(`/api/v1/journals/${entryId}/void`).set(auth(admin));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ENTRY_ALREADY_VOID');
  });

  it('rejects journal lines for unknown or other-company accounts', async () => {
    const send = (accountId: string) =>
      request(app)
        .post('/api/v1/journals')
        .set(auth(admin))
        .send({
          entryDate: '2026-03-07',
          lines: [
            { accountId, entryType: 'DEBIT', amount: 10 },
            { accountId: SYSTEM.apId, entryType: 'CREDIT', amount: 10 },
          ],
        });

    const unknown = await send(randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const otherCompany = await send(foreign.accountId);
    expect(otherCompany.status).toBe(404);
    expect(otherCompany.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const draft = await request(app)
      .post('/api/v1/journals')
      .set(auth(admin))
      .send({ entryDate: '2026-03-07', lines: balancedLines() });
    const patched = await request(app)
      .patch(`/api/v1/journals/${draft.body.entryId}`)
      .set(auth(admin))
      .send({
        lines: [
          { accountId: foreign.accountId, entryType: 'DEBIT', amount: 10 },
          { accountId: SYSTEM.apId, entryType: 'CREDIT', amount: 10 },
        ],
      });
    expect(patched.status).toBe(404);
    expect(patched.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    await prisma.journalEntry.deleteMany({ where: { entryId: draft.body.entryId } });
  });

  it('rejects inactive accounts when creating, editing or posting', async () => {
    const accountId = randomUUID();
    await prisma.chartOfAccount.create({
      data: {
        accountId,
        companyId,
        accountCode: `T-${randomUUID().slice(0, 8)}`,
        accountName: 'Temporary account for inactive checks',
        accountType: 'EXPENSE',
      },
    });

    const lines = () => [
      { accountId, entryType: 'DEBIT' as const, amount: 12 },
      { accountId: SYSTEM.apId, entryType: 'CREDIT' as const, amount: 12 },
    ];

    let draftId = '';
    try {
      const draft = await request(app)
        .post('/api/v1/journals')
        .set(auth(admin))
        .send({ entryDate: '2026-03-08', lines: lines() });
      expect(draft.status).toBe(201);
      draftId = draft.body.entryId;

      await prisma.chartOfAccount.update({ where: { accountId }, data: { isActive: false } });

      const created = await request(app)
        .post('/api/v1/journals')
        .set(auth(admin))
        .send({ entryDate: '2026-03-08', lines: lines() });
      expect(created.status).toBe(422);
      expect(created.body.error.code).toBe('ACCOUNT_INACTIVE');

      const patched = await request(app)
        .patch(`/api/v1/journals/${draftId}`)
        .set(auth(admin))
        .send({ lines: lines() });
      expect(patched.status).toBe(422);
      expect(patched.body.error.code).toBe('ACCOUNT_INACTIVE');

      const posted = await request(app)
        .post(`/api/v1/journals/${draftId}/post`)
        .set(auth(admin));
      expect(posted.status).toBe(422);
      expect(posted.body.error.code).toBe('ACCOUNT_INACTIVE');
    } finally {
      if (draftId) await prisma.journalEntry.deleteMany({ where: { entryId: draftId } });
      await prisma.chartOfAccount.deleteMany({ where: { accountId } });
    }
  });

  it('trial balance sums posted entries by account', async () => {
    const before = await request(app)
      .get('/api/v1/reports/trial-balance')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(auth(accountant));
    const beforeDebit =
      before.body.find((r: { accountCode: string }) => r.accountCode === '1200')?.debit ?? 0;
    const beforeCredit =
      before.body.find((r: { accountCode: string }) => r.accountCode === '1200')?.credit ?? 0;

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
    expect(inventory.credit).toBe(beforeCredit);
  });

  it('posts and reports decimal amounts without float drift', async () => {
    const tb = () =>
      request(app)
        .get('/api/v1/reports/trial-balance')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .set(auth(admin));

    const before = await tb();
    const beforeDebit =
      before.body.find((r: { accountCode: string }) => r.accountCode === '1200')?.debit ?? 0;

    const created = await request(app)
      .post('/api/v1/journals')
      .set(auth(admin))
      .send({
        entryDate: '2026-03-06',
        lines: [
          { accountId: SYSTEM.inventoryId, entryType: 'DEBIT', amount: 0.1 },
          { accountId: SYSTEM.inventoryId, entryType: 'DEBIT', amount: 0.2 },
          { accountId: SYSTEM.apId, entryType: 'CREDIT', amount: 0.3 },
        ],
      });
    expect(created.status).toBe(201);

    const posted = await request(app)
      .post(`/api/v1/journals/${created.body.entryId}/post`)
      .set(auth(admin));
    expect(posted.status).toBe(200);

    const after = await tb();
    const afterDebit =
      after.body.find((r: { accountCode: string }) => r.accountCode === '1200')?.debit ?? 0;
    expect(new Decimal(afterDebit).minus(beforeDebit).toString()).toBe('0.3');
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
