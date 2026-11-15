import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { redis, closeRedis } from '../../lib/redis';

const app = createApp();

let admin = '';
const createdAccountIds: string[] = [];
const createdEntryIds: string[] = [];

const auth = () => ({ authorization: `Bearer ${admin}` });
const code = () => `T-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@acme.test', password: 'Passw0rd!' });
  admin = res.body.accessToken;
});

afterAll(async () => {
  if (createdEntryIds.length > 0) {
    await prisma.journalEntry.deleteMany({ where: { entryId: { in: createdEntryIds } } });
  }
  if (createdAccountIds.length > 0) {
    await prisma.chartOfAccount.deleteMany({ where: { accountId: { in: createdAccountIds } } });
  }
  await prisma.$disconnect();
  closeRedis();
});

async function createAccount(
  input: { parentAccountId?: string; accountType?: 'ASSET' | 'EXPENSE' } = {},
): Promise<{ accountId: string; accountCode: string }> {
  const res = await request(app)
    .post('/api/v1/accounts')
    .set(auth())
    .send({
      accountCode: code(),
      accountName: 'Test account',
      accountType: input.accountType ?? 'ASSET',
      parentAccountId: input.parentAccountId,
    });
  expect(res.status).toBe(201);
  createdAccountIds.push(res.body.accountId);
  return res.body;
}

describe('account hierarchy and type guards', () => {
  it('rejects a parent assignment that would create a cycle', async () => {
    const parent = await createAccount();
    const child = await createAccount({ parentAccountId: parent.accountId });

    const cycle = await request(app)
      .patch(`/api/v1/accounts/${parent.accountId}`)
      .set(auth())
      .send({ parentAccountId: child.accountId });
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('INVALID_PARENT');

    const self = await request(app)
      .patch(`/api/v1/accounts/${parent.accountId}`)
      .set(auth())
      .send({ parentAccountId: parent.accountId });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('INVALID_PARENT');

    // Clearing the parent stays allowed.
    const cleared = await request(app)
      .patch(`/api/v1/accounts/${parent.accountId}`)
      .set(auth())
      .send({ parentAccountId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.parentAccountId).toBeNull();
  });

  it('rejects changing the type of an account that has journal lines', async () => {
    const account = await createAccount({ accountType: 'ASSET' });
    const draft = await request(app)
      .post('/api/v1/journals')
      .set(auth())
      .send({
        entryDate: '2026-04-01',
        lines: [
          { accountId: account.accountId, entryType: 'DEBIT', amount: 10 },
          { accountId: account.accountId, entryType: 'CREDIT', amount: 10 },
        ],
      });
    expect(draft.status).toBe(201);
    createdEntryIds.push(draft.body.entryId);

    const retyped = await request(app)
      .patch(`/api/v1/accounts/${account.accountId}`)
      .set(auth())
      .send({ accountType: 'EXPENSE' });
    expect(retyped.status).toBe(409);
    expect(retyped.body.error.code).toBe('ACCOUNT_TYPE_IN_USE');

    // Editing the name or deactivating remains allowed.
    const retired = await request(app)
      .patch(`/api/v1/accounts/${account.accountId}`)
      .set(auth())
      .send({ accountName: 'Renamed', isActive: false });
    expect(retired.status).toBe(200);
    expect(retired.body.accountName).toBe('Renamed');
    expect(retired.body.isActive).toBe(false);
  });

  it('still allows retyping an unused account', async () => {
    const account = await createAccount({ accountType: 'ASSET' });
    const retyped = await request(app)
      .patch(`/api/v1/accounts/${account.accountId}`)
      .set(auth())
      .send({ accountType: 'EXPENSE' });
    expect(retyped.status).toBe(200);
    expect(retyped.body.accountType).toBe('EXPENSE');
  });
});
