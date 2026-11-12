import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AccountType, MovementType } from '@erp/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import '../src/config/env';

/**
 * Phase C3 — demo scenario: a busy month of activity on top of the base seed,
 * so every page (Dashboard, COA, Journals, Products, Warehouses, Stock,
 * Movements, Settings) shows a company with real workload. Idempotent:
 * everything is either fixed-id (skipDuplicates) or guarded by the DEMO
 * reference marker; re-running skips. Dates are RELATIVE to today so the demo
 * always looks recent.
 *
 * Run: npm run db:seed:demo -w apps/api
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '33333333-0000-0000-0000-000000000001';
const STORE_ID = '33333333-0000-0000-0000-000000000003';
const REFERENCE_TYPE = 'DEMO';

const ROLE_ACCOUNTANT = '22222222-0000-0000-0000-000000000002';
const ROLE_VIEWER = '22222222-0000-0000-0000-000000000004';
const DEMO_USERS = [
  { userId: '33333333-0000-0000-0000-000000000601', roleId: ROLE_VIEWER, email: 'dana@acme.test', fullName: 'Dana Viewer', roleCode: 'VIEWER' },
  { userId: '33333333-0000-0000-0000-000000000602', roleId: ROLE_ACCOUNTANT, email: 'erin@acme.test', fullName: 'Erin Entry', roleCode: 'ACCOUNTANT' },
];

const W1 = '55555555-0000-0000-0000-000000000101'; // EAST
const W2 = '55555555-0000-0000-0000-000000000102'; // WEST
const W3 = '55555555-0000-0000-0000-000000000103'; // RET
const DEMO_WAREHOUSES = [
  { warehouseId: W1, companyId: COMPANY_ID, code: 'EAST', name: 'East Side Depot', locationAddress: '88 Foundry Lane' },
  { warehouseId: W2, companyId: COMPANY_ID, code: 'WEST', name: 'Westgate Hub', locationAddress: '3 Riverside Park' },
  { warehouseId: W3, companyId: COMPANY_ID, code: 'RET', name: 'Retail Outlet', locationAddress: '1 Market Square' },
];

/** sku, name, unitOfMeasure, reorderThreshold, unitCost (GL basis for issues). */
const P = (n: number, sku: string, name: string, uom: string, threshold: number, unitCost: number) => ({
  productId: `66666666-0000-0000-0000-0000000002${String(n).padStart(2, '0')}`,
  companyId: COMPANY_ID,
  sku,
  name,
  description: null,
  unitOfMeasure: uom,
  reorderThreshold: threshold,
  unitCost,
});
const DEMO_PRODUCTS = [
  P(1, 'DEMO-101', 'Ergonomic Office Chair', 'PCS', 10, 85),
  P(2, 'DEMO-102', 'Standing Desk 120cm', 'PCS', 5, 220),
  P(3, 'DEMO-103', 'HD Webcam', 'PCS', 25, 35),
  P(4, 'DEMO-104', 'LED Desk Lamp', 'PCS', 30, 12),
  P(5, 'DEMO-105', 'Notebook A4 (pack of 5)', 'BOX', 40, 3.5),
  P(6, 'DEMO-106', 'Printer Paper 80gsm', 'BOX', 100, 8),
  P(7, 'DEMO-107', 'Toner Cartridge 12A', 'PCS', 15, 55),
  P(8, 'DEMO-108', 'Coffee Beans 1kg', 'KG', 20, 9),
  P(9, 'DEMO-109', 'Safety Gloves', 'BOX', 50, 4),
];

const SALES = '4000';
const AR = '1100';
const INVENTORY = '1200';
const AP = '2000';
const COGS = '5000';

const SUBACCOUNTS: {
  accountId: string;
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId: string | null;
}[] = [
  { accountId: '44444444-0000-0000-0000-000000000501', companyId: COMPANY_ID, accountCode: '5110', accountName: 'Rent', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000502', companyId: COMPANY_ID, accountCode: '5120', accountName: 'Payroll', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000503', companyId: COMPANY_ID, accountCode: '5130', accountName: 'Utilities', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000504', companyId: COMPANY_ID, accountCode: '5140', accountName: 'Marketing', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000505', companyId: COMPANY_ID, accountCode: '5150', accountName: 'Depreciation', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000506', companyId: COMPANY_ID, accountCode: '5160', accountName: 'Bank Fees', accountType: 'EXPENSE', parentAccountId: '44444444-0000-0000-0000-000000000009' },
  { accountId: '44444444-0000-0000-0000-000000000507', companyId: COMPANY_ID, accountCode: '1590', accountName: 'Accumulated Depreciation', accountType: 'ASSET', parentAccountId: null },
];

/** Signed-quantity ledger (issues/transfers-out negative — shared-seed convention). */
type Mv = { day: number; hour: number; type: MovementType; sku: string; wh: string; qty: number; cost: number };
const MV = (day: number, hour: number, type: MovementType, sku: string, wh: string, qty: number, cost: number): Mv => ({ day, hour, type, sku, wh, qty, cost });
const RECEIPTS: Mv[] = [
  MV(29, 9, 'GOODS_RECEIPT', 'DEMO-101', 'MAIN', 60, 85),
  MV(29, 10, 'GOODS_RECEIPT', 'DEMO-101', 'EAST', 20, 85),
  MV(28, 9, 'GOODS_RECEIPT', 'DEMO-102', 'MAIN', 25, 220),
  MV(28, 11, 'GOODS_RECEIPT', 'DEMO-103', 'MAIN', 80, 35),
  MV(28, 14, 'GOODS_RECEIPT', 'DEMO-103', 'EAST', 40, 35),
  MV(27, 9, 'GOODS_RECEIPT', 'DEMO-104', 'RET', 60, 12),
  MV(27, 10, 'GOODS_RECEIPT', 'DEMO-105', 'RET', 120, 3.5),
  MV(27, 13, 'GOODS_RECEIPT', 'DEMO-105', 'MAIN', 50, 3.5),
  MV(26, 9, 'GOODS_RECEIPT', 'DEMO-106', 'EAST', 400, 8),
  MV(26, 11, 'GOODS_RECEIPT', 'DEMO-107', 'MAIN', 30, 55),
  MV(26, 15, 'GOODS_RECEIPT', 'DEMO-108', 'RET', 40, 9),
  MV(25, 10, 'GOODS_RECEIPT', 'DEMO-109', 'EAST', 150, 4),
];
const OUTFLOWS: Mv[] = [
  MV(24, 10, 'SALES_ISSUE', 'DEMO-101', 'MAIN', -6, 85),
  MV(23, 14, 'SALES_ISSUE', 'DEMO-102', 'MAIN', -9, 220),
  MV(22, 11, 'SALES_ISSUE', 'DEMO-103', 'MAIN', -30, 35),
  MV(21, 9, 'SALES_ISSUE', 'DEMO-101', 'EAST', -3, 85),
  MV(20, 16, 'SALES_ISSUE', 'DEMO-104', 'RET', -40, 12),
  MV(19, 10, 'SALES_ISSUE', 'DEMO-105', 'RET', -95, 3.5),
  MV(18, 9, 'TRANSFER_OUT', 'DEMO-103', 'MAIN', -10, 0),
  MV(18, 9, 'TRANSFER_IN', 'DEMO-103', 'EAST', 10, 0),
  MV(17, 13, 'SALES_ISSUE', 'DEMO-106', 'EAST', -180, 8),
  MV(16, 10, 'SALES_ISSUE', 'DEMO-107', 'MAIN', -10, 55),
  MV(15, 11, 'TRANSFER_OUT', 'DEMO-101', 'MAIN', -5, 0),
  MV(15, 11, 'TRANSFER_IN', 'DEMO-101', 'EAST', 5, 0),
  MV(14, 9, 'SALES_ISSUE', 'DEMO-108', 'RET', -25, 9),
  MV(13, 15, 'SALES_ISSUE', 'DEMO-105', 'MAIN', -10, 3.5),
  MV(12, 10, 'TRANSFER_OUT', 'DEMO-109', 'EAST', -20, 0),
  MV(12, 10, 'TRANSFER_IN', 'DEMO-109', 'RET', 20, 0),
  MV(11, 14, 'SALES_ISSUE', 'DEMO-103', 'EAST', -12, 35),
  MV(10, 10, 'SALES_ISSUE', 'DEMO-102', 'MAIN', -4, 220),
  MV(9, 11, 'SALES_ISSUE', 'DEMO-101', 'MAIN', -8, 85),
  MV(8, 9, 'SALES_ISSUE', 'DEMO-104', 'RET', -10, 12),
  MV(7, 13, 'ADJUSTMENT', 'DEMO-107', 'MAIN', -2, 0),
  MV(5, 9, 'ADJUSTMENT', 'DEMO-106', 'EAST', 5, 8),
  MV(4, 15, 'SALES_ISSUE', 'DEMO-109', 'EAST', -60, 4),
  MV(3, 10, 'SALES_ISSUE', 'DEMO-103', 'MAIN', -20, 35),
  MV(2, 14, 'SALES_ISSUE', 'DEMO-106', 'EAST', -25, 8),
];

/** (daysAgo, [debitCode, creditCode, amount, description]) — balanced pairs. */
type ManualEntry = { day: number; hour: number; posted: boolean; lines: [string, string, number, string][] };
const MANUAL_JOURNALS: ManualEntry[] = [
  { day: 29, hour: 8, posted: true, lines: [['1000', '3000', 25_000, 'Owner capital injection']] },
  { day: 26, hour: 9, posted: true, lines: [['5110', '1000', 3_500, 'Office rent — month 1']] },
  { day: 24, hour: 15, posted: true, lines: [['1000', SALES, 9_260, 'Weekly cash sales — week 1']] },
  { day: 22, hour: 11, posted: true, lines: [['5130', '1000', 1_980, 'Utilities and internet']] },
  { day: 21, hour: 16, posted: true, lines: [[AR, SALES, 6_750, 'Customer invoice — Meridian Ltd']] },
  { day: 19, hour: 14, posted: true, lines: [['1000', SALES, 11_430, 'Weekly cash sales — week 2']] },
  { day: 17, hour: 10, posted: true, lines: [['5140', '1000', 2_400, 'Q4 marketing campaign']] },
  { day: 15, hour: 12, posted: true, lines: [['5100', '1010', 320, 'Petty cash — office supplies']] },
  { day: 14, hour: 9, posted: true, lines: [['1000', SALES, 10_515, 'Weekly cash sales — week 3']] },
  { day: 12, hour: 10, posted: true, lines: [[AP, '1000', 12_000, 'Supplier payment — on account']] },
  { day: 10, hour: 15, posted: true, lines: [[AR, SALES, 4_320, 'Customer invoice — Northwind Co.']] },
  { day: 8, hour: 9, posted: true, lines: [['5120', '1000', 7_200, 'Payroll — month 1']] },
  { day: 7, hour: 11, posted: true, lines: [['5150', '1590', 800, 'Depreciation — fixtures and equipment']] },
  { day: 5, hour: 14, posted: true, lines: [['1000', SALES, 13_880, 'Weekly cash sales — week 4']] },
  { day: 4, hour: 10, posted: true, lines: [['5160', '1000', 65, 'Bank fees and charges']] },
  { day: 3, hour: 11, posted: true, lines: [[AR, SALES, 5_880, 'Customer invoice — Zenith Traders']] },
  { day: 2, hour: 16, posted: false, lines: [['5130', AP, 2_140, 'Utility bill — awaiting payment']] },
  { day: 2, hour: 9, posted: false, lines: [['5110', '1000', 3_500, 'Office rent — month 2 (draft)']] },
  { day: 1, hour: 10, posted: false, lines: [['1000', AR, 6_750, 'Expected receipt — Meridian Ltd (draft)']] },
];

function at(daysAgo: number, hour: number): Date {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/** Same JE-#### allocation scheme as the API (no concurrency here). */
async function nextEntryNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: bigint | number }[]>`
    SELECT coalesce(max((substring(entry_number from 'JE-([0-9]+)$'))::bigint), 0) AS max
    FROM journal_entries WHERE company_id::text = ${COMPANY_ID}`;
  const max = Number(rows[0]?.max ?? 0);
  return `JE-${String(max + 1).padStart(4, '0')}`;
}

/** DRAFT insert → (optionally) POSTED flip, mirroring the API's posting path. */
async function createEntry(args: {
  entryDate: Date;
  lines: { accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: number; description?: string | null }[];
  posted: boolean;
  referenceType: string;
  referenceId: string | null;
  createdBy: string;
}): Promise<void> {
  const entry = await prisma.journalEntry.create({
    data: {
      companyId: COMPANY_ID,
      entryNumber: await nextEntryNumber(),
      entryDate: args.entryDate,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      status: 'DRAFT',
      createdBy: args.createdBy,
      createdAt: args.entryDate,
      lines: { create: args.lines },
    },
  });
  if (args.posted) {
    await prisma.journalEntry.update({
      where: { entryId: entry.entryId },
      data: { status: 'POSTED', postedAt: args.entryDate },
    });
  }
}

async function main(): Promise<void> {
  const existingJournals = await prisma.journalEntry.count({
    where: { companyId: COMPANY_ID, referenceType: REFERENCE_TYPE },
  });
  const existingDemoProducts = await prisma.product.count({
    where: { companyId: COMPANY_ID, sku: { startsWith: 'DEMO-' } },
  });
  if (existingJournals > 0 || existingDemoProducts > 0) {
    console.log(`demo seed skipped — ${existingJournals} DEMO entries / ${existingDemoProducts} DEMO products already exist`);
    return;
  }

  // Extra users (Settings page) with their roles.
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { userId: u.userId },
      update: {},
      create: {
        userId: u.userId,
        companyId: COMPANY_ID,
        email: u.email,
        fullName: u.fullName,
        passwordHash: await bcrypt.hash('Passw0rd!', 10),
      },
    });
    await prisma.userRole.createMany({
      data: [{ userId: u.userId, roleId: u.roleId }],
      skipDuplicates: true,
    });
  }

  await prisma.chartOfAccount.createMany({ data: SUBACCOUNTS, skipDuplicates: true });
  await prisma.warehouse.createMany({ data: DEMO_WAREHOUSES, skipDuplicates: true });
  await prisma.product.createMany({
    data: DEMO_PRODUCTS.map(({ unitCost: _cost, ...p }) => p),
    skipDuplicates: true,
  });

  // Movement ledger — fixed ids so re-seeds never duplicate.
  const productBySku = new Map(DEMO_PRODUCTS.map((p) => [p.sku, p]));
  const whId = new Map(
    (await prisma.warehouse.findMany({ where: { companyId: COMPANY_ID } })).map((w) => [w.code, w.warehouseId]),
  );
  const allMovements = [...RECEIPTS, ...OUTFLOWS];
  await prisma.inventoryTransaction.createMany({
    data: allMovements.map((m, i) => ({
      transactionId: `77777777-0000-0000-0000-0000000003${String(i + 1).padStart(2, '0')}`,
      companyId: COMPANY_ID,
      productId: productBySku.get(m.sku)!.productId,
      warehouseId: whId.get(m.wh)!,
      movementType: m.type,
      quantity: m.qty,
      unitCost: m.cost,
      referenceId: null,
      createdBy: m.type === 'ADJUSTMENT' ? ADMIN_ID : STORE_ID,
      createdAt: at(m.day, m.hour),
    })),
    skipDuplicates: true,
  });

  // Stock reconciles exactly with the movement ledger above.
  const stockByCombo = new Map<string, number>();
  const reservedByCombo = new Map<string, number>([
    [`DEMO-101|MAIN`, 4],
    [`DEMO-102|MAIN`, 1],
    [`DEMO-103|MAIN`, 2],
  ]);
  for (const m of allMovements) {
    const key = `${m.sku}|${m.wh}`;
    stockByCombo.set(key, (stockByCombo.get(key) ?? 0) + m.qty);
  }
  for (const [key, qty] of stockByCombo) {
    if (qty === 0) continue;
    const [sku, code] = key.split('|');
    await prisma.inventoryStock.upsert({
      where: {
        productId_warehouseId: {
          productId: productBySku.get(sku)!.productId,
          warehouseId: whId.get(code)!,
        },
      },
      update: { quantityOnHand: qty },
      create: {
        companyId: COMPANY_ID,
        productId: productBySku.get(sku)!.productId,
        warehouseId: whId.get(code)!,
        quantityOnHand: qty,
        quantityReserved: reservedByCombo.get(key) ?? 0,
      },
    });
  }

  const accountId = new Map(
    (await prisma.chartOfAccount.findMany({ where: { companyId: COMPANY_ID } })).map((a) => [a.accountCode, a.accountId]),
  );

  // Inventory → GL auto-journals (same shape the API posts: WORKFLOWS §7–8),
  // with referenceId pointing at the originating movement like the API does.
  const movementRows = allMovements.map((m, i) => ({
    transactionId: `77777777-0000-0000-0000-0000000003${String(i + 1).padStart(2, '0')}`,
    m,
  }));
  for (const { transactionId, m } of movementRows) {
    if (m.type === 'GOODS_RECEIPT') {
      await createEntry({
        entryDate: at(m.day, m.hour),
        posted: true,
        referenceType: 'INVENTORY_RECEIPT',
        referenceId: transactionId,
        createdBy: STORE_ID,
        lines: [
          { accountId: accountId.get(INVENTORY)!, entryType: 'DEBIT', amount: m.qty * m.cost, description: `Goods receipt — ${m.sku}` },
          { accountId: accountId.get(AP)!, entryType: 'CREDIT', amount: m.qty * m.cost, description: 'Payable to supplier' },
        ],
      });
    } else if (m.type === 'SALES_ISSUE' && m.cost > 0) {
      await createEntry({
        entryDate: at(m.day, m.hour),
        posted: true,
        referenceType: 'SALES_ISSUE',
        referenceId: transactionId,
        createdBy: STORE_ID,
        lines: [
          { accountId: accountId.get(COGS)!, entryType: 'DEBIT', amount: Math.abs(m.qty) * m.cost, description: `Cost of goods sold — ${m.sku}` },
          { accountId: accountId.get(INVENTORY)!, entryType: 'CREDIT', amount: Math.abs(m.qty) * m.cost, description: null },
        ],
      });
    }
  }

  // Manual GL activity for the month.
  for (const j of MANUAL_JOURNALS) {
    await createEntry({
      entryDate: at(j.day, j.hour),
      posted: j.posted,
      referenceType: REFERENCE_TYPE,
      referenceId: null,
      createdBy: ADMIN_ID,
      lines: j.lines.map(([debit, credit, amount, description]) => [
        { accountId: accountId.get(debit)!, entryType: 'DEBIT' as const, amount, description },
        { accountId: accountId.get(credit)!, entryType: 'CREDIT' as const, amount, description: null },
      ]).flat(),
    });
  }

  const counts = {
    demoProducts: DEMO_PRODUCTS.length,
    demoWarehouses: DEMO_WAREHOUSES.length,
    demoStockRows: stockByCombo.size,
    demoMovements: allMovements.length,
    demoJournals: await prisma.journalEntry.count({
      where: { companyId: COMPANY_ID, OR: [{ referenceType: REFERENCE_TYPE }, { referenceType: { in: ['INVENTORY_RECEIPT', 'SALES_ISSUE'] } }] },
    }),
  };
  console.log('demo seed complete', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
