import { z } from 'zod';
import {
  MOVEMENT_TYPES,
  type MovementType,
  type StocktakeStatus,
} from '../constants';
import { optionalIsoDateSchema, uuidSchema } from './common';

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

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const stockFilterSchema = z.object({
  productId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  warehouseId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  lowStock: z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  }, z.boolean().optional()),
  search: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() || undefined : value),
    z.string().optional(),
  ),
});

export type StockFilter = z.infer<typeof stockFilterSchema>;

export const movementFilterSchema = z.object({
  productId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  warehouseId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  movementType: z.preprocess(emptyToUndefined, z.enum(MOVEMENT_TYPES).optional()),
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});

export type MovementFilter = z.infer<typeof movementFilterSchema>;

export const stocktakeLineInputSchema = z.object({
  productId: z.string().uuid(),
  countedQuantity: z.number().int().min(0),
});

export const createStocktakeSchema = z.object({
  warehouseId: z.string().uuid(),
  notes: z.string().max(500).nullable().optional(),
  lines: z.array(stocktakeLineInputSchema).min(1),
});

export type CreateStocktakeInput = z.infer<typeof createStocktakeSchema>;

export interface StocktakeLine {
  lineId: string;
  productId: string;
  sku: string;
  productName: string;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
}

export interface Stocktake {
  stocktakeId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  status: StocktakeStatus;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  appliedBy: string | null;
  appliedByName: string | null;
  appliedAt: string | null;
  createdAt: string;
  lines: StocktakeLine[];
}
