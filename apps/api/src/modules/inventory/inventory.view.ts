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
 * Applies one stock delta under a row lock (FOR UPDATE), creating the stock
 * row on first movement. `quantityDelta` may be negative; negative results
 * are rejected (also guarded by a DB CHECK).
 */
export async function applyStockDelta(
  tx: PrismaTx,
  args: { companyId: string; productId: string; warehouseId: string; quantityDelta: number },
): Promise<void> {
  await tx.$executeRaw`SELECT quantity_on_hand FROM inventory_stock
    WHERE product_id::text = ${args.productId} AND warehouse_id::text = ${args.warehouseId}
    FOR UPDATE`;

  const existing = await tx.inventoryStock.findFirst({
    where: { productId: args.productId, warehouseId: args.warehouseId },
  });
  const next = (existing?.quantityOnHand ?? 0) + args.quantityDelta;
  if (next < 0) {
    throw new ApiInsufficientStock(existing?.quantityOnHand ?? 0, Math.abs(args.quantityDelta));
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
        warehouseId: args.warehouseId,
        quantityOnHand: next,
      },
    });
  }
}
