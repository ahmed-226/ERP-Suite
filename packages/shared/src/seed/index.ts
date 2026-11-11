import type {
  AccountType,
  EntryType,
  JournalStatus,
  MovementType,
  Permission,
} from '../constants';

/**
 * The demo dataset. The web mock store and (Stage B) the API seeder both load
 * this, so switching `VITE_DATA_SOURCE` from `mock` to `http` shows the same
 * starting world. Ids are fixed so records are stable across reloads.
 */

export interface SeedCompany {
  companyId: string;
  name: string;
}

export interface SeedRole {
  roleId: string;
  companyId: string;
  code: string;
  name: string;
  permissions: Permission[];
}

export interface SeedUser {
  userId: string;
  companyId: string;
  email: string;
  fullName: string;
  roleCode: string;
  /** Dev-only plaintext password. The API stores a bcrypt hash instead. */
  password: string;
}

export interface SeedAccount {
  accountId: string;
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId: string | null;
}

export interface SeedWarehouse {
  warehouseId: string;
  companyId: string;
  code: string;
  name: string;
  locationAddress: string | null;
}

export interface SeedProduct {
  productId: string;
  companyId: string;
  sku: string;
  name: string;
  description: string | null;
  unitOfMeasure: string;
  reorderThreshold: number;
}

export interface SeedStock {
  productId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
}

export interface SeedMovement {
  transactionId: string;
  productId: string;
  warehouseId: string;
  movementType: MovementType;
  quantity: number;
  unitCost: number;
  referenceId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SeedJournalLine {
  accountId: string;
  entryType: EntryType;
  amount: number;
  description: string | null;
}

export interface SeedJournal {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  referenceType: string | null;
  referenceId: string | null;
  status: JournalStatus;
  postedAt: string | null;
  createdBy: string;
  createdAt: string;
  lines: SeedJournalLine[];
}

export interface SeedData {
  company: SeedCompany;
  roles: SeedRole[];
  users: SeedUser[];
  accounts: SeedAccount[];
  warehouses: SeedWarehouse[];
  products: SeedProduct[];
  stock: SeedStock[];
  movements: SeedMovement[];
  journals: SeedJournal[];
}

const companyId = '11111111-1111-1111-1111-111111111111';
const now = '2026-01-01T08:00:00.000Z';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: [
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
  ],
  ACCOUNTANT: [
    'accounts:read',
    'accounts:write',
    'journals:read',
    'journals:write',
    'journals:post',
    'products:read',
    'warehouses:read',
    'inventory:read',
    'reports:read',
  ],
  STOREKEEPER: [
    'products:read',
    'products:write',
    'warehouses:read',
    'warehouses:write',
    'inventory:read',
    'inventory:write',
    'reports:read',
  ],
  VIEWER: [
    'accounts:read',
    'journals:read',
    'products:read',
    'warehouses:read',
    'inventory:read',
    'reports:read',
  ],
};

const roles: SeedRole[] = [
  { roleId: '22222222-0000-0000-0000-000000000001', companyId, code: 'ADMIN', name: 'Administrator', permissions: ROLE_PERMISSIONS.ADMIN },
  { roleId: '22222222-0000-0000-0000-000000000002', companyId, code: 'ACCOUNTANT', name: 'Accountant', permissions: ROLE_PERMISSIONS.ACCOUNTANT },
  { roleId: '22222222-0000-0000-0000-000000000003', companyId, code: 'STOREKEEPER', name: 'Storekeeper', permissions: ROLE_PERMISSIONS.STOREKEEPER },
  { roleId: '22222222-0000-0000-0000-000000000004', companyId, code: 'VIEWER', name: 'Viewer', permissions: ROLE_PERMISSIONS.VIEWER },
];

const users: SeedUser[] = [
  { userId: '33333333-0000-0000-0000-000000000001', companyId, email: 'admin@acme.test', fullName: 'Alice Admin', roleCode: 'ADMIN', password: 'Passw0rd!' },
  { userId: '33333333-0000-0000-0000-000000000002', companyId, email: 'accountant@acme.test', fullName: 'Bob Ledger', roleCode: 'ACCOUNTANT', password: 'Passw0rd!' },
  { userId: '33333333-0000-0000-0000-000000000003', companyId, email: 'store@acme.test', fullName: 'Carol Stock', roleCode: 'STOREKEEPER', password: 'Passw0rd!' },
];

const accounts: SeedAccount[] = [
  { accountId: '44444444-0000-0000-0000-000000000001', companyId, accountCode: '1000', accountName: 'Cash and Bank', accountType: 'ASSET', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000002', companyId, accountCode: '1010', accountName: 'Petty Cash', accountType: 'ASSET', parentAccountId: '44444444-0000-0000-0000-000000000001' },
  { accountId: '44444444-0000-0000-0000-000000000003', companyId, accountCode: '1100', accountName: 'Accounts Receivable', accountType: 'ASSET', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000004', companyId, accountCode: '1200', accountName: 'Inventory', accountType: 'ASSET', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000005', companyId, accountCode: '2000', accountName: 'Accounts Payable', accountType: 'LIABILITY', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000006', companyId, accountCode: '3000', accountName: "Owner's Equity", accountType: 'EQUITY', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000007', companyId, accountCode: '4000', accountName: 'Sales Revenue', accountType: 'REVENUE', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000008', companyId, accountCode: '5000', accountName: 'Cost of Goods Sold', accountType: 'EXPENSE', parentAccountId: null },
  { accountId: '44444444-0000-0000-0000-000000000009', companyId, accountCode: '5100', accountName: 'Operating Expenses', accountType: 'EXPENSE', parentAccountId: null },
];

const warehouses: SeedWarehouse[] = [
  { warehouseId: '55555555-0000-0000-0000-000000000001', companyId, code: 'MAIN', name: 'Main Warehouse', locationAddress: '12 Industrial Rd, Warehouse District' },
  { warehouseId: '55555555-0000-0000-0000-000000000002', companyId, code: 'SEC', name: 'Secondary Warehouse', locationAddress: '5 Dockside Ave' },
];

const products: SeedProduct[] = [
  { productId: '66666666-0000-0000-0000-000000000001', companyId, sku: 'SKU-1001', name: 'Wireless Mouse', description: '2.4GHz optical mouse', unitOfMeasure: 'PCS', reorderThreshold: 20 },
  { productId: '66666666-0000-0000-0000-000000000002', companyId, sku: 'SKU-1002', name: 'Mechanical Keyboard', description: 'TKL mechanical keyboard', unitOfMeasure: 'PCS', reorderThreshold: 10 },
  { productId: '66666666-0000-0000-0000-000000000003', companyId, sku: 'SKU-1003', name: '27" Monitor', description: '1440p IPS monitor', unitOfMeasure: 'PCS', reorderThreshold: 5 },
  { productId: '66666666-0000-0000-0000-000000000004', companyId, sku: 'SKU-2001', name: 'USB-C Cable', description: '1m braided cable', unitOfMeasure: 'PCS', reorderThreshold: 50 },
  { productId: '66666666-0000-0000-0000-000000000005', companyId, sku: 'SKU-2002', name: 'Laptop Stand', description: 'Aluminium adjustable stand', unitOfMeasure: 'PCS', reorderThreshold: 15 },
];

const stock: SeedStock[] = [
  { productId: products[0].productId, warehouseId: warehouses[0].warehouseId, quantityOnHand: 120, quantityReserved: 5 },
  { productId: products[1].productId, warehouseId: warehouses[0].warehouseId, quantityOnHand: 8, quantityReserved: 0 },
  { productId: products[2].productId, warehouseId: warehouses[0].warehouseId, quantityOnHand: 3, quantityReserved: 1 },
  { productId: products[3].productId, warehouseId: warehouses[1].warehouseId, quantityOnHand: 300, quantityReserved: 0 },
  { productId: products[4].productId, warehouseId: warehouses[0].warehouseId, quantityOnHand: 40, quantityReserved: 2 },
];

const movements: SeedMovement[] = [
  { transactionId: '77777777-0000-0000-0000-000000000001', productId: products[0].productId, warehouseId: warehouses[0].warehouseId, movementType: 'GOODS_RECEIPT', quantity: 120, unitCost: 12.5, referenceId: null, createdBy: users[2].userId, createdAt: '2026-01-03T09:15:00.000Z' },
  { transactionId: '77777777-0000-0000-0000-000000000002', productId: products[1].productId, warehouseId: warehouses[0].warehouseId, movementType: 'GOODS_RECEIPT', quantity: 10, unitCost: 45, referenceId: null, createdBy: users[2].userId, createdAt: '2026-01-03T09:20:00.000Z' },
  { transactionId: '77777777-0000-0000-0000-000000000003', productId: products[1].productId, warehouseId: warehouses[0].warehouseId, movementType: 'SALES_ISSUE', quantity: -2, unitCost: 45, referenceId: null, createdBy: users[2].userId, createdAt: '2026-01-04T14:05:00.000Z' },
  { transactionId: '77777777-0000-0000-0000-000000000004', productId: products[3].productId, warehouseId: warehouses[1].warehouseId, movementType: 'GOODS_RECEIPT', quantity: 300, unitCost: 2.25, referenceId: null, createdBy: users[2].userId, createdAt: '2026-01-05T11:00:00.000Z' },
  { transactionId: '77777777-0000-0000-0000-000000000005', productId: products[4].productId, warehouseId: warehouses[0].warehouseId, movementType: 'ADJUSTMENT', quantity: 40, unitCost: 18, referenceId: null, createdBy: users[0].userId, createdAt: '2026-01-06T16:30:00.000Z' },
];

const journals: SeedJournal[] = [
  {
    entryId: '88888888-0000-0000-0000-000000000001',
    entryNumber: 'JE-0001',
    entryDate: '2026-01-03',
    referenceType: 'INVENTORY_RECEIPT',
    referenceId: movements[0].transactionId,
    status: 'POSTED',
    postedAt: '2026-01-03T09:16:00.000Z',
    createdBy: users[2].userId,
    createdAt: '2026-01-03T09:16:00.000Z',
    lines: [
      { accountId: accounts[3].accountId, entryType: 'DEBIT', amount: 1500, description: 'Inventory received - SKU-1001' },
      { accountId: accounts[4].accountId, entryType: 'CREDIT', amount: 1500, description: 'Payable to supplier' },
    ],
  },
  {
    entryId: '88888888-0000-0000-0000-000000000002',
    entryNumber: 'JE-0002',
    entryDate: '2026-01-10',
    referenceType: 'MANUAL',
    referenceId: null,
    status: 'DRAFT',
    postedAt: null,
    createdBy: users[1].userId,
    createdAt: '2026-01-10T10:00:00.000Z',
    lines: [
      { accountId: accounts[8].accountId, entryType: 'DEBIT', amount: 1200, description: 'Office supplies' },
      { accountId: accounts[0].accountId, entryType: 'CREDIT', amount: 1200, description: 'Paid from bank' },
    ],
  },
];

export const seed: SeedData = {
  company: { companyId, name: 'Acme Trading Co.' },
  roles,
  users,
  accounts,
  warehouses,
  products,
  stock,
  movements,
  journals,
};

export const seedCreatedAt = now;
