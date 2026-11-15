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
      .send({ productId, warehouseId, quantity: 4 });
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

  it('prices issues from the valuation cost, ignoring any client-supplied unitCost', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { productId } });
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId, warehouseId, quantity: 1, unitCost: 0 });
    expect(res.status).toBe(201);
    expect(Number(res.body.unitCost)).toBe(Number(product.averageCost));

    const entry = await prisma.journalEntry.findFirst({
      where: { referenceId: res.body.transactionId, referenceType: 'SALES_ISSUE' },
      include: { lines: true },
    });
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe('POSTED');
    const debit = entry!.lines
      .filter((l) => l.entryType === 'DEBIT')
      .reduce((sum, l) => sum + Number(l.amount), 0);
    expect(debit).toBe(Number(product.averageCost));
  });

  it('a failed movement rolls back everything (no orphan stock or journal)', async () => {
    // Issue more than on hand: the whole transaction must roll back.
    const stockBefore = await prisma.inventoryStock.findFirst({
      where: { productId, warehouseId },
    });
    const entriesBefore = await prisma.journalEntry.count({
      where: { referenceId: { not: null }, referenceType: 'SALES_ISSUE' },
    });
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId, warehouseId, quantity: 999999 });
    expect(res.status).toBe(422);

    const stockAfter = await prisma.inventoryStock.findFirst({
      where: { productId, warehouseId },
    });
    expect(stockAfter!.quantityOnHand).toBe(stockBefore!.quantityOnHand);
    const entriesAfter = await prisma.journalEntry.count({
      where: { referenceId: { not: null }, referenceType: 'SALES_ISSUE' },
    });
    expect(entriesAfter).toBe(entriesBefore);
  });

  it('posts adjustment write-offs and gains against operating expenses', async () => {
    const writeOff = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth())
      .send({ productId, warehouseId, quantityDelta: -2, reason: 'Damaged' });
    expect(writeOff.status).toBe(201);

    const lossEntry = await prisma.journalEntry.findFirst({
      where: { referenceId: writeOff.body.transactionId, referenceType: 'ADJUSTMENT' },
      include: { lines: { include: { account: true } } },
    });
    expect(lossEntry).toBeTruthy();
    expect(lossEntry!.status).toBe('POSTED');
    const lossDebit = lossEntry!.lines.find((l) => l.entryType === 'DEBIT');
    const lossCredit = lossEntry!.lines.find((l) => l.entryType === 'CREDIT');
    expect(lossDebit!.account.accountCode).toBe('5100');
    expect(lossCredit!.account.accountCode).toBe('1200');
    expect(Number(lossDebit!.amount)).toBe(15);

    const gain = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth())
      .send({ productId, warehouseId, quantityDelta: 2, reason: 'Found stock' });
    expect(gain.status).toBe(201);

    const gainEntry = await prisma.journalEntry.findFirst({
      where: { referenceId: gain.body.transactionId, referenceType: 'ADJUSTMENT' },
      include: { lines: { include: { account: true } } },
    });
    expect(gainEntry).toBeTruthy();
    const gainDebit = gainEntry!.lines.find((l) => l.entryType === 'DEBIT');
    const gainCredit = gainEntry!.lines.find((l) => l.entryType === 'CREDIT');
    expect(gainDebit!.account.accountCode).toBe('1200');
    expect(gainCredit!.account.accountCode).toBe('5100');
    expect(Number(gainDebit!.amount)).toBe(15);
  });

  it('keeps inventory GL equal to the valuation report for fully posted activity', async () => {
    const secondWarehouse = (
      await request(app).get('/api/v1/warehouses').set('authorization', `Bearer ${admin}`)
    ).body[1].warehouseId as string;

    const created = await request(app)
      .post('/api/v1/products')
      .set('authorization', `Bearer ${admin}`)
      .send({ sku: `TEST-RECON-${Date.now()}`, name: 'Reconciliation product' });
    const reconProductId = created.body.productId as string;

    const inventoryNet = async (): Promise<number> => {
      const report = await request(app)
        .get('/api/v1/reports/trial-balance')
        .query({ from: '2000-01-01', to: '2100-01-01' })
        .set('authorization', `Bearer ${admin}`);
      const row = report.body.find((r: { accountCode: string }) => r.accountCode === '1200');
      return row?.net ?? 0;
    };

    const inventoryBefore = await inventoryNet();

    await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth())
      .send({ productId: reconProductId, warehouseId, quantity: 10, unitCost: 10 })
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId: reconProductId, warehouseId, quantity: 2 })
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth())
      .send({ productId: reconProductId, warehouseId, quantityDelta: -3, reason: 'Shrinkage' })
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth())
      .send({ productId: reconProductId, warehouseId, quantityDelta: 1, reason: 'Count gain' })
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/transfers')
      .set(auth())
      .send({
        productId: reconProductId,
        fromWarehouseId: warehouseId,
        toWarehouseId: secondWarehouse,
        quantity: 2,
      })
      .expect(201);

    const inventoryAfter = await inventoryNet();
    const report = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set('authorization', `Bearer ${admin}`);
    const row = report.body.rows.find(
      (r: { productId: string }) => r.productId === reconProductId,
    );
    expect(row).toMatchObject({ quantityOnHand: 6, averageCost: 10, value: 60 });
    expect(inventoryAfter - inventoryBefore).toBeCloseTo(row.value, 4);
  });

  it('posts nothing for zero-value movements and documents that behaviour', async () => {
    const created = await request(app)
      .post('/api/v1/products')
      .set('authorization', `Bearer ${admin}`)
      .send({ sku: `TEST-ZERO-${Date.now()}`, name: 'Zero value product' });
    const zeroProductId = created.body.productId as string;

    const receipt = await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth())
      .send({ productId: zeroProductId, warehouseId, quantity: 5, unitCost: 0 });
    expect(receipt.status).toBe(201);
    expect(
      await prisma.journalEntry.count({
        where: { referenceId: receipt.body.transactionId, referenceType: 'INVENTORY_RECEIPT' },
      }),
    ).toBe(0);

    const issue = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth())
      .send({ productId: zeroProductId, warehouseId, quantity: 1 });
    expect(issue.status).toBe(201);
    expect(
      await prisma.journalEntry.count({
        where: { referenceId: issue.body.transactionId, referenceType: 'SALES_ISSUE' },
      }),
    ).toBe(0);

    const adjustment = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth())
      .send({ productId: zeroProductId, warehouseId, quantityDelta: 2, reason: 'Count gain' });
    expect(adjustment.status).toBe(201);
    expect(
      await prisma.journalEntry.count({
        where: { referenceId: adjustment.body.transactionId, referenceType: 'ADJUSTMENT' },
      }),
    ).toBe(0);
  });
});
