import type { AccountType } from '../constants';
import type { InventoryStock } from './inventory';
import type { JournalEntry } from './journal';

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
  net: number;
}

export interface TrialBalanceFilter {
  from: string;
  to: string;
}

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
