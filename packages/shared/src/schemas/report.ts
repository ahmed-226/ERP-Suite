import { z } from 'zod';
import type { AccountType, MovementType } from '../constants';
import type { InventoryStock } from './inventory';
import type { JournalEntry } from './journal';
import { isoDateSchema, optionalIsoDateSchema } from './common';

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  net: number;
}

export const trialBalanceFilterSchema = z.object({
  from: isoDateSchema.default('0001-01-01'),
  to: isoDateSchema.default('9999-12-31'),
});

export type TrialBalanceFilter = z.infer<typeof trialBalanceFilterSchema>;

/** Stock valued at the company-wide weighted-average cost, per product/warehouse. */
export interface InventoryValuationRow {
  productId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  averageCost: number;
  value: number;
}

export interface InventoryValuationReport {
  rows: InventoryValuationRow[];
  totalValue: number;
  /** Posted GL balance of the inventory account (1200) for reconciliation. */
  inventoryAccountBalance: number;
  /** totalValue - inventoryAccountBalance (0 when reconciled). */
  difference: number;
}

export const inventoryMovementSummaryFilterSchema = z.object({
  from: isoDateSchema.default('0001-01-01'),
  to: isoDateSchema.default('9999-12-31'),
});

export type InventoryMovementSummaryFilter = z.infer<
  typeof inventoryMovementSummaryFilterSchema
>;

export interface InventoryMovementSummaryRow {
  period: string;
  movementType: MovementType;
  movementCount: number;
  quantityIn: number;
  quantityOut: number;
  totalValue: number;
}

export interface InventoryMovementSummaryReport {
  rows: InventoryMovementSummaryRow[];
}

export const inventoryAgingFilterSchema = z.object({
  /** Reference date for age calculation (defaults to today). */
  asOf: optionalIsoDateSchema,
});

export type InventoryAgingFilter = z.infer<typeof inventoryAgingFilterSchema>;

export interface InventoryAgingRow {
  productId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  averageCost: number;
  value: number;
  lastMovementAt: string | null;
  daysSinceLastMovement: number | null;
}

export interface InventoryAgingReport {
  asOf: string;
  rows: InventoryAgingRow[];
}

export interface DashboardStats {
  accountsCount: number;
  productsCount: number;
  warehousesCount: number;
  journalsCount: number;
  draftJournals: number;
  postedJournals: number;
  lowStockCount: number;
  totalStockUnits: number;
  recentJournals: JournalEntry[];
  lowStock: InventoryStock[];
}
