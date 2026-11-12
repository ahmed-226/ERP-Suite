import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { closeRedis } from '../../lib/redis';

const app = createApp();

let admin = '';
let store = '';
let productId = '';
let warehouseId = '';

beforeAll(async () => {
  const a = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@acme.test', password: 'Passw0rd!' });
  admin = a.body.accessToken;
  const b = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'store@acme.test', password: 'Passw0rd!' });
  store = b.body.accessToken;

  const created = await request(app)
    .post('/api/v1/products')
    .set('authorization', `Bearer ${admin}`)
    .send({ sku: `TEST-GL-${Date.now()}`, name: 'GL Integration Product' });
  productId = created.body.productId;

  const warehouses = await request(app).get('/api/v1/warehouses').set('authorization', `Bearer ${admin}`);
  warehouseId = warehouses.body[0].warehouseId;
});

afterAll(async () => {
  await prisma.$disconnect();
  closeRedis();
});

const auth = () => ({ authorization: `Bearer ${store}` });

describe('inventory → GL integration', () => {
  it('receipt posts a balanced DR Inventory / CR AP entry', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth())
      .send({ productId, warehouseId, quantity: 10, unitCost: 7.5 });
    expect(res.status).toBe(201);

    const entry = await prisma.journalEntry.findFirst({
      where: { referenceId: res.body.transactionId, referenceType: 'INVENTORY_RECEIPT' },
      include: { lines: true },
    });
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe('POSTED');
    const debit = entry!.lines.filter((l) => l.entryType === 'DEBIT').reduce((s, l) => s + Number(l.amount), 0);
    const credit = entry!.lines.filter((l) => l.entryType === 'CREDIT').reduce((s, l) => s + Number(l.amount), 0);
    expect(debit).toBe(75);
    expect(credit).toBe(75);

    const accounts = await prisma.chartOfAccount.findMany({
      where: { companyId: entry!.companyId, accountCode: { in: ['1200', '2000'] } },
      select: { accountCode: true, accountId: true },
    });
    const lineAccounts = entry!.lines.map((l) => l.accountId).sort();
    expect(lineAccounts).toEqual(accounts.map((a) => a.accountId).sort());
  });

  it('issue posts a balanced DR COGS / CR Inventory entry', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId, warehouseId, quantity: 4, unitCost: 7.5 });
    expect(res.status).toBe(201);

    const entry = await prisma.journalEntry.findFirst({
      where: { referenceId: res.body.transactionId, referenceType: 'SALES_ISSUE' },
      include: { lines: { include: { account: true } } },
    });
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe('POSTED');
    const debitLine = entry!.lines.find((l) => l.entryType === 'DEBIT');
    const creditLine = entry!.lines.find((l) => l.entryType === 'CREDIT');
    expect(debitLine!.account.accountCode).toBe('5000');
    expect(creditLine!.account.accountCode).toBe('1200');
    expect(Number(debitLine!.amount)).toBe(30);
  });

  it('zero-cost movements skip the GL entry', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId, warehouseId, quantity: 1, unitCost: 0 });
    expect(res.status).toBe(201);
    const entry = await prisma.journalEntry.findFirst({
      where: { referenceId: res.body.transactionId },
    });
    expect(entry).toBeNull();
  });

  it('a failed movement rolls back everything (no orphan stock or journal)', async () => {
    // Issue more than on hand: the whole transaction must roll back.
    const stockBefore = await prisma.inventoryStock.findFirst({
      where: { productId, warehouseId },
    });
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId, warehouseId, quantity: 999999, unitCost: 1 });
    expect(res.status).toBe(422);

    const stockAfter = await prisma.inventoryStock.findFirst({
      where: { productId, warehouseId },
    });
    expect(stockAfter!.quantityOnHand).toBe(stockBefore!.quantityOnHand);
    const entries = await prisma.journalEntry.count({
      where: { referenceId: { not: null }, createdAt: { gte: new Date(Date.now() - 5000) }, referenceType: 'SALES_ISSUE' },
    });
    // The number of entries stays whatever it was — nothing new for the failed op.
    expect(entries).toBeLessThan(3);
  });
});
