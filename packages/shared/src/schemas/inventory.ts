import { z } from 'zod';
import type { MovementType } from '../constants';

export const receiptSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitCost: z.number().min(0),
  referenceType: z.string().max(50).nullable().optional(),
  referenceId: z.string().uuid().nullable().optional(),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const issueSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitCost: z.number().min(0).optional(),
  referenceType: z.string().max(50).nullable().optional(),
  referenceId: z.string().uuid().nullable().optional(),
});
export type IssueInput = z.infer<typeof issueSchema>;

export const transferSchema = z
  .object({
    productId: z.string().uuid(),
    fromWarehouseId: z.string().uuid(),
    toWarehouseId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: 'Source and destination warehouses must differ',
    path: ['toWarehouseId'],
  });
export type TransferInput = z.infer<typeof transferSchema>;

export const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantityDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Adjustment delta cannot be zero'),
  unitCost: z.number().min(0).optional(),
  reason: z.string().min(1).max(500),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export interface InventoryStock {
  stockId: string;
  productId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  quantityReserved: number;
  reorderThreshold: number;
  isLowStock: boolean;
  updatedAt: string;
}

export interface InventoryTransaction {
  transactionId: string;
  productId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  movementType: MovementType;
  quantity: number;
  unitCost: number;
  referenceId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface StockFilter {
  productId?: string;
  warehouseId?: string;
  lowStock?: boolean;
  search?: string;
}

export interface MovementFilter {
  productId?: string;
  warehouseId?: string;
  movementType?: MovementType;
  from?: string;
  to?: string;
}
