import { z } from 'zod';
import type { AccountType } from '../constants';
import type { InventoryStock } from './inventory';
import type { JournalEntry } from './journal';
import { isoDateSchema } from './common';

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

/** One product's stock valued at the company-wide weighted-average cost. */
export interface InventoryValuationRow {
  productId: string;
  sku: string;
  productName: string;
  quantityOnHand: number;
  averageCost: number;
  value: number;
}

export interface InventoryValuationReport {
  rows: InventoryValuationRow[];
  totalValue: number;
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
