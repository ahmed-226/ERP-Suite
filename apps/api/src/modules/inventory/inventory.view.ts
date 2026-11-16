import type { InventoryStock, InventoryTransaction } from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError } from '../../lib/errors';
import type {
  InventoryStock as StockModel,
  InventoryTransaction as MovementModel,
} from '../../generated/prisma/client';

export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type FullStockRow = StockModel & {
  product: { sku: string; name: string; reorderThreshold: number };
  warehouse: { code: string; name: string };
};

export type FullMovementRow = MovementModel & {
  product: { sku: string; name: string };
  warehouse: { code: string };
  createdByUser: { fullName: string };
};

export function serializeStock(s: FullStockRow): InventoryStock {
  return {
    stockId: s.stockId,
    productId: s.productId,
    warehouseId: s.warehouseId,
    sku: s.product.sku,
    productName: s.product.name,
    warehouseCode: s.warehouse.code,
    warehouseName: s.warehouse.name,
    quantityOnHand: s.quantityOnHand,
    quantityReserved: s.quantityReserved,
    reorderThreshold: s.product.reorderThreshold,
    isLowStock: s.quantityOnHand <= s.product.reorderThreshold,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function serializeMovement(m: FullMovementRow): InventoryTransaction {
  return {
    transactionId: m.transactionId,
    productId: m.productId,
    warehouseId: m.warehouseId,
    sku: m.product.sku,
    productName: m.product.name,
    warehouseCode: m.warehouse.code,
    movementType: m.movementType,
    quantity: m.quantity,
    unitCost: Number(m.unitCost),
    referenceId: m.referenceId,
    createdBy: m.createdBy,
    createdByName: m.createdByUser.fullName,
    createdAt: m.createdAt.toISOString(),
  };
}

export const stockInclude = {
  product: { select: { sku: true, name: true, reorderThreshold: true } },
  warehouse: { select: { code: true, name: true } },
} as const;

export const movementInclude = {
  product: { select: { sku: true, name: true } },
  warehouse: { select: { code: true } },
  createdByUser: { select: { fullName: true } },
} as const;

export class ApiInsufficientStock extends ApiError {
  constructor(onHand: number, requested: number) {
    super(422, 'INSUFFICIENT_STOCK', `Insufficient stock: ${requested} requested, ${onHand} on hand`);
  }
}

/**
 * Serializes stock writes for each (product, warehouse) bucket with
 * transaction-scoped advisory locks. A row lock cannot guard the first
 * movement: the stock row does not exist yet, so `FOR UPDATE` locks nothing
 * and concurrent inserts race on the unique key. Locks are taken in sorted
 * key order so that a transfer and its reverse cannot deadlock.
 */
async function lockStockBuckets(
  tx: PrismaTx,
  productId: string,
  warehouseIds: readonly string[],
): Promise<void> {
  const keys = [...new Set(warehouseIds)]
    .sort()
    .map((warehouseId) => `inventory_stock:${productId}:${warehouseId}`);
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

/**
 * Serializes the read-blend-write of the company-wide moving average. Without
 * it two receipts both read the same average and the last write wins, silently
 * dropping the other receipt's cost. The product row always exists, so a plain
 * row lock is enough.
 */
export async function lockProductCosting(tx: PrismaTx, productId: string): Promise<void> {
  await tx.$executeRaw`SELECT product_id FROM products
    WHERE product_id = ${productId}::uuid
    FOR UPDATE`;
}

/**
 * Applies stock deltas, creating missing stock rows on first movement. Every
 * delta is validated before any row is written. Deltas may be negative;
 * negative results are rejected (also guarded by a DB CHECK).
 */
export async function applyStockDeltas(
  tx: PrismaTx,
  args: {
    companyId: string;
    productId: string;
    deltas: ReadonlyArray<{ warehouseId: string; quantityDelta: number }>;
  },
): Promise<void> {
  await lockStockBuckets(
    tx,
    args.productId,
    args.deltas.map((delta) => delta.warehouseId),
  );

  for (const delta of args.deltas) {
    const existing = await tx.inventoryStock.findFirst({
      where: { productId: args.productId, warehouseId: delta.warehouseId },
    });
    const next = (existing?.quantityOnHand ?? 0) + delta.quantityDelta;
    if (next < 0) {
      throw new ApiInsufficientStock(existing?.quantityOnHand ?? 0, Math.abs(delta.quantityDelta));
    }
    if (existing) {
      await tx.inventoryStock.update({
        where: { stockId: existing.stockId },
        data: { quantityOnHand: next },
      });
    } else {
      await tx.inventoryStock.create({
        data: {
          companyId: args.companyId,
          productId: args.productId,
          warehouseId: delta.warehouseId,
          quantityOnHand: next,
        },
      });
    }
  }
}
