/**
 * Domain enums and the permission catalog. These values are shared by the client,
 * the mock store, and (Stage B) the API and database CHECK constraints, so they
 * must stay in sync with `dev/docs/erd.md`.
 */

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_STATUSES = ['DRAFT', 'POSTED', 'VOIDED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const ENTRY_TYPES = ['DEBIT', 'CREDIT'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const MOVEMENT_TYPES = [
  'GOODS_RECEIPT',
  'SALES_ISSUE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PERMISSIONS = [
  'accounts:read',
  'accounts:write',
  'journals:read',
  'journals:write',
  'journals:post',
  'products:read',
  'products:write',
  'warehouses:read',
  'warehouses:write',
  'inventory:read',
  'inventory:write',
  'reports:read',
  'users:read',
  'users:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = ['ADMIN', 'ACCOUNTANT', 'STOREKEEPER', 'VIEWER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Chart-of-accounts codes the inventory/GL integration depends on. */
export const SYSTEM_ACCOUNT_CODES = {
  inventory: '1200',
  accountsPayable: '2000',
  salesRevenue: '4000',
  costOfGoodsSold: '5000',
} as const;
