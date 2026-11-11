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
