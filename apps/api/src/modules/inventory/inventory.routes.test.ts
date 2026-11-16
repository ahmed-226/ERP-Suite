import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/db';
import { redis, closeRedis } from '../../lib/redis';

const app = createApp();

let admin = '';
let store = '';
let productId = '';
let warehouseId = '';

beforeAll(async () => {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);

  const a = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@acme.test', password: 'Passw0rd!' });
  admin = a.body.accessToken;
  const b = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'store@acme.test', password: 'Passw0rd!' });
  store = b.body.accessToken;

  const products = await request(app).get('/api/v1/products').set('authorization', `Bearer ${admin}`);
  productId = products.body.find((p: { sku: string }) => p.sku.startsWith('TEST'))?.productId ??
    (await request(app).post('/api/v1/products').set('authorization', `Bearer ${admin}`).send({ sku: 'TEST-STOCK-1', name: 'Stock Test Product' })).body.productId;

  const warehouses = await request(app).get('/api/v1/warehouses').set('authorization', `Bearer ${admin}`);
  warehouseId = warehouses.body[0].warehouseId;
});

afterAll(async () => {
  await prisma.$disconnect();
  closeRedis();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Current on-hand for (product, warehouse); 0 when no stock row exists yet. */
async function onHand(warehouseId: string): Promise<number> {
  const stock = await request(app)
    .get('/api/v1/inventory/stock')
    .query({ productId })
    .set(auth(store));
  return Number(
    stock.body.find((s: { warehouseId: string }) => s.warehouseId === warehouseId)?.quantityOnHand ?? 0,
  );
}

describe('inventory movements', () => {
  it('receipt increases stock and records the movement', async () => {
    const before = await onHand(warehouseId);
    const res = await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth(store))
      .send({ productId, warehouseId, quantity: 100, unitCost: 2.5 });
    expect(res.status).toBe(201);
    expect(res.body.movementType).toBe('GOODS_RECEIPT');
    expect(res.body.quantity).toBe(100);
    expect(await onHand(warehouseId)).toBe(before + 100);
  });

  it('issue beyond on-hand stock fails with INSUFFICIENT_STOCK', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth(store))
      .send({ productId, warehouseId, quantity: 999 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('issue decreases stock', async () => {
    const before = await onHand(warehouseId);
    const res = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth(store))
      .send({ productId, warehouseId, quantity: 30 });
    expect(res.status).toBe(201);
    expect(res.body.movementType).toBe('SALES_ISSUE');
    expect(res.body.quantity).toBe(-30);
    expect(await onHand(warehouseId)).toBe(before - 30);
  });

  it('transfer moves stock between warehouses as an OUT/IN pair', async () => {
    const warehouses = await request(app).get('/api/v1/warehouses').set('authorization', `Bearer ${admin}`);
    const dest = warehouses.body[1]?.warehouseId;
    expect(dest).toBeTruthy();

    const beforeSrc = await onHand(warehouseId);
    const beforeDest = await onHand(dest);
    const res = await request(app)
      .post('/api/v1/inventory/transfers')
      .set(auth(store))
      .send({ productId, fromWarehouseId: warehouseId, toWarehouseId: dest, quantity: 20 });
    expect(res.status).toBe(201);
    expect(res.body.map((m: { movementType: string }) => m.movementType)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    expect(res.body.map((m: { quantity: number }) => m.quantity)).toEqual([-20, 20]);
    expect(await onHand(warehouseId)).toBe(beforeSrc - 20);
    expect(await onHand(dest)).toBe(beforeDest + 20);
  });

  it('adjustment applies a signed delta', async () => {
    const before = await onHand(warehouseId);
    const res = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth(store))
      .send({ productId, warehouseId, quantityDelta: -5, reason: 'Damage write-off' });
    expect(res.status).toBe(201);
    expect(res.body.movementType).toBe('ADJUSTMENT');
    expect(res.body.quantity).toBe(-5);
    expect(await onHand(warehouseId)).toBe(before - 5);
  });

  it('movements list is append-only audit order and enriched', async () => {
    const res = await request(app)
      .get('/api/v1/inventory/movements')
      .query({ productId })
      .set(auth(store));
    expect(res.status).toBe(200);
    expect(res.body[0].createdByName).toBeTruthy();
    expect(res.body[0].sku).toBeTruthy();
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });

  it('accountant cannot move stock (no inventory:write)', async () => {
    const acct = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'accountant@acme.test', password: 'Passw0rd!' });
    const res = await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth(acct.body.accessToken))
      .send({ productId, warehouseId, quantity: 1, unitCost: 1 });
    expect(res.status).toBe(403);
  });
});

describe('weighted-average inventory valuation', () => {
  it('blends receipts into the average and prices every outflow server-side', async () => {
    const sku = `TEST-AVG-${Date.now()}`;
    const created = await request(app)
      .post('/api/v1/products')
      .set(auth(admin))
      .send({ sku, name: 'Average cost test product' });
    expect(created.status).toBe(201);
    const avgProductId = created.body.productId as string;
    expect(created.body.averageCost).toBe(0);

    const secondWarehouse = (
      await request(app).get('/api/v1/warehouses').set(auth(admin))
    ).body[1].warehouseId as string;

    await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth(store))
      .send({ productId: avgProductId, warehouseId, quantity: 10, unitCost: 10 })
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth(store))
      .send({ productId: avgProductId, warehouseId, quantity: 10, unitCost: 20 })
      .expect(201);

    const product = await request(app).get(`/api/v1/products/${avgProductId}`).set(auth(admin));
    expect(product.body.averageCost).toBe(15);

    // A client-supplied unitCost is not part of the contract and cannot win.
    const issue = await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth(store))
      .send({ productId: avgProductId, warehouseId, quantity: 4, unitCost: 999 });
    expect(issue.status).toBe(201);
    expect(issue.body.unitCost).toBe(15);

    const adjustment = await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth(store))
      .send({ productId: avgProductId, warehouseId, quantityDelta: -2, reason: 'Damage' });
    expect(adjustment.status).toBe(201);
    expect(adjustment.body.unitCost).toBe(15);

    const transfer = await request(app)
      .post('/api/v1/inventory/transfers')
      .set(auth(store))
      .send({
        productId: avgProductId,
        fromWarehouseId: warehouseId,
        toWarehouseId: secondWarehouse,
        quantity: 3,
      });
    expect(transfer.status).toBe(201);
    expect(transfer.body.map((m: { unitCost: number }) => m.unitCost)).toEqual([15, 15]);

    const report = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set(auth(admin));
    expect(report.status).toBe(200);
    const row = report.body.rows.find(
      (r: { productId: string }) => r.productId === avgProductId,
    );
    expect(row).toMatchObject({ quantityOnHand: 14, averageCost: 15, value: 210 });
    const summed = report.body.rows.reduce(
      (sum: number, r: { value: number }) => sum + r.value,
      0,
    );
    expect(report.body.totalValue).toBeCloseTo(summed, 4);
  });

  it('records COGS at valuation cost on the issue journal', async () => {
    const before = await request(app)
      .get('/api/v1/reports/trial-balance')
      .query({ from: '2000-01-01', to: '2100-01-01' })
      .set(auth(admin));
    const cogsBefore = before.body.find((r: { accountCode: string }) => r.accountCode === '5000');
    const inventoryBefore = before.body.find((r: { accountCode: string }) => r.accountCode === '1200');

    const sku = `TEST-COGS-${Date.now()}`;
    const created = await request(app)
      .post('/api/v1/products')
      .set(auth(admin))
      .send({ sku, name: 'COGS test product' });
    const cogsProductId = created.body.productId as string;

    await request(app)
      .post('/api/v1/inventory/receipts')
      .set(auth(store))
      .send({ productId: cogsProductId, warehouseId, quantity: 20, unitCost: 7.25 });
    await request(app)
      .post('/api/v1/inventory/issues')
      .set(auth(store))
      .send({ productId: cogsProductId, warehouseId, quantity: 8 })
      .expect(201);

    const after = await request(app)
      .get('/api/v1/reports/trial-balance')
      .query({ from: '2000-01-01', to: '2100-01-01' })
      .set(auth(admin));
    const cogsAfter = after.body.find((r: { accountCode: string }) => r.accountCode === '5000');
    const inventoryAfter = after.body.find((r: { accountCode: string }) => r.accountCode === '1200');

    expect(cogsAfter.debit - (cogsBefore?.debit ?? 0)).toBeCloseTo(8 * 7.25, 4);
    expect(inventoryAfter.net - (inventoryBefore?.net ?? 0)).toBeCloseTo(20 * 7.25 - 8 * 7.25, 4);
  });
});
