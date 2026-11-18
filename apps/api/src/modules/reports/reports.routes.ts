import { Router } from 'express';
import {
  Decimal,
  SYSTEM_ACCOUNT_CODES,
  accountLedgerFilterSchema,
  balanceSheetFilterSchema,
  financialStatementFilterSchema,
  inventoryAgingFilterSchema,
  inventoryMovementSummaryFilterSchema,
  money,
  moneyToNumber,
  sumMoney,
  trialBalanceFilterSchema,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { entryInclude, serializeEntry } from '../journals/journal.view';

export const reportRouter = Router();

reportRouter.use(requireAuth);

/** Posted GL balance for a system account code (all time). */
async function accountBalance(companyId: string, accountCode: string): Promise<number> {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      entry: { companyId, status: 'POSTED' },
      account: { companyId, accountCode },
    },
    select: { entryType: true, amount: true },
  });
  let net = new Decimal(0);
  for (const line of lines) {
    const amount = line.amount.toString();
    net = line.entryType === 'DEBIT' ? net.plus(amount) : net.minus(amount);
  }
  return moneyToNumber(net);
}

/** GET /reports/trial-balance?from=&to= — posted entries only. */
reportRouter.get('/trial-balance', requirePermission('reports:read'), async (req, res) => {
  const { from, to } = trialBalanceFilterSchema.parse(req.query);
  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId: req.user!.companyId,
      status: 'POSTED',
      entryDate: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T23:59:59.999Z`),
      },
    },
    select: {
      lines: {
        select: {
          accountId: true,
          entryType: true,
          amount: true,
          account: {
            select: { accountId: true, accountCode: true, accountName: true, accountType: true },
          },
        },
      },
    },
  });

  const rows = new Map<
    string,
    { accountId: string; accountCode: string; accountName: string; accountType: string; debit: Decimal; credit: Decimal }
  >();
  for (const line of entries.flatMap((e) => e.lines)) {
    let row = rows.get(line.accountId);
    if (!row) {
      row = {
        accountId: line.accountId,
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        accountType: line.account.accountType,
        debit: new Decimal(0),
        credit: new Decimal(0),
      };
      rows.set(line.accountId, row);
    }
    if (line.entryType === 'DEBIT') row.debit = row.debit.plus(line.amount.toString());
    else row.credit = row.credit.plus(line.amount.toString());
  }
  res.status(200).json(
    [...rows.values()]
      .map((r) => ({
        ...r,
        debit: moneyToNumber(r.debit),
        credit: moneyToNumber(r.credit),
        net: moneyToNumber(r.debit.minus(r.credit)),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
  );
});

/** GET /reports/inventory-valuation — stock by product/warehouse at weighted-average cost, reconciled to GL 1200. */
reportRouter.get('/inventory-valuation', requirePermission('reports:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const [stock, inventoryAccountBalance] = await Promise.all([
    prisma.inventoryStock.findMany({
      where: { companyId },
      include: {
        product: { select: { sku: true, name: true, averageCost: true } },
        warehouse: { select: { code: true, name: true } },
      },
    }),
    accountBalance(companyId, SYSTEM_ACCOUNT_CODES.inventory),
  ]);

  const valued = stock
    .filter((s) => s.quantityOnHand !== 0)
    .map((s) => {
      const value = money(s.quantityOnHand).times(s.product.averageCost.toString());
      return {
        productId: s.productId,
        warehouseId: s.warehouseId,
        sku: s.product.sku,
        productName: s.product.name,
        warehouseCode: s.warehouse.code,
        warehouseName: s.warehouse.name,
        quantityOnHand: s.quantityOnHand,
        averageCost: moneyToNumber(s.product.averageCost),
        value: moneyToNumber(value),
        _value: value,
      };
    })
    .sort(
      (a, b) =>
        a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode),
    );

  const totalValue = moneyToNumber(sumMoney(valued.map((row) => row._value)));
  res.status(200).json({
    rows: valued.map(({ _value: _v, ...row }) => row),
    totalValue,
    inventoryAccountBalance,
    difference: moneyToNumber(money(totalValue).minus(inventoryAccountBalance)),
  });
});

/** GET /reports/inventory-movement-summary?from=&to= — movement totals by type and period. */
reportRouter.get(
  '/inventory-movement-summary',
  requirePermission('reports:read'),
  async (req, res) => {
    const { from, to } = inventoryMovementSummaryFilterSchema.parse(req.query);
    const movements = await prisma.inventoryTransaction.findMany({
      where: {
        companyId: req.user!.companyId,
        createdAt: {
          gte: new Date(`${from}T00:00:00.000Z`),
          lte: new Date(`${to}T23:59:59.999Z`),
        },
      },
      select: { movementType: true, quantity: true, unitCost: true, createdAt: true },
    });

    const groups = new Map<
      string,
      {
        period: string;
        movementType: string;
        movementCount: number;
        quantityIn: Decimal;
        quantityOut: Decimal;
        totalValue: Decimal;
      }
    >();

    for (const m of movements) {
      const period = m.createdAt.toISOString().slice(0, 7); // YYYY-MM
      const key = `${period}|${m.movementType}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          period,
          movementType: m.movementType,
          movementCount: 0,
          quantityIn: new Decimal(0),
          quantityOut: new Decimal(0),
          totalValue: new Decimal(0),
        };
        groups.set(key, row);
      }
      row.movementCount += 1;
      const qty = Math.abs(m.quantity);
      const value = money(qty).times(m.unitCost.toString());
      row.totalValue = row.totalValue.plus(value);
      if (m.quantity >= 0) row.quantityIn = row.quantityIn.plus(qty);
      else row.quantityOut = row.quantityOut.plus(qty);
    }

    const rows = [...groups.values()]
      .map((r) => ({
        period: r.period,
        movementType: r.movementType,
        movementCount: r.movementCount,
        quantityIn: moneyToNumber(r.quantityIn),
        quantityOut: moneyToNumber(r.quantityOut),
        totalValue: moneyToNumber(r.totalValue),
      }))
      .sort(
        (a, b) => a.period.localeCompare(b.period) || a.movementType.localeCompare(b.movementType),
      );

    res.status(200).json({ rows });
  },
);

/** GET /reports/inventory-aging?asOf= — on-hand stock with days since last movement. */
reportRouter.get('/inventory-aging', requirePermission('reports:read'), async (req, res) => {
  const { asOf } = inventoryAgingFilterSchema.parse(req.query);
  const companyId = req.user!.companyId;
  const asOfDate = new Date(`${asOf ?? new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);

  const [stock, lastMoves] = await Promise.all([
    prisma.inventoryStock.findMany({
      where: { companyId, quantityOnHand: { gt: 0 } },
      include: {
        product: { select: { sku: true, name: true, averageCost: true } },
        warehouse: { select: { code: true, name: true } },
      },
    }),
    prisma.inventoryTransaction.groupBy({
      by: ['productId', 'warehouseId'],
      where: { companyId },
      _max: { createdAt: true },
    }),
  ]);

  const lastByKey = new Map(
    lastMoves.map((m) => [`${m.productId}|${m.warehouseId}`, m._max.createdAt]),
  );

  const rows = stock
    .map((s) => {
      const last = lastByKey.get(`${s.productId}|${s.warehouseId}`) ?? null;
      const daysSinceLastMovement =
        last === null
          ? null
          : Math.max(0, Math.floor((asOfDate.getTime() - last.getTime()) / 86_400_000));
      return {
        productId: s.productId,
        warehouseId: s.warehouseId,
        sku: s.product.sku,
        productName: s.product.name,
        warehouseCode: s.warehouse.code,
        warehouseName: s.warehouse.name,
        quantityOnHand: s.quantityOnHand,
        averageCost: moneyToNumber(s.product.averageCost),
        value: moneyToNumber(money(s.quantityOnHand).times(s.product.averageCost.toString())),
        lastMovementAt: last ? last.toISOString() : null,
        daysSinceLastMovement,
      };
    })
    .sort((a, b) => {
      const da = a.daysSinceLastMovement ?? -1;
      const db = b.daysSinceLastMovement ?? -1;
      return db - da || a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode);
    });

  res.status(200).json({ asOf: asOfDate.toISOString().slice(0, 10), rows });
});

/** GET /reports/account-ledger/:accountId — posted lines with opening/running balance. */
reportRouter.get(
  '/account-ledger/:accountId',
  requirePermission('reports:read'),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const accountId = req.params.accountId as string;
    const { from, to } = accountLedgerFilterSchema.parse(req.query);

    const account = await prisma.chartOfAccount.findFirst({
      where: { accountId, companyId },
      select: { accountId: true, accountCode: true, accountName: true, accountType: true },
    });
    if (!account) throw notFound('Account');

    const lines = await prisma.journalEntryLine.findMany({
      where: {
        accountId,
        account: { companyId },
        entry: { companyId, status: 'POSTED', entryDate: { lte: new Date(`${to}T00:00:00.000Z`) } },
      },
      select: {
        lineId: true,
        entryId: true,
        entryType: true,
        amount: true,
        description: true,
        entry: {
          select: {
            entryNumber: true,
            entryDate: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { entry: { entryDate: 'asc' } },
        { entry: { entryNumber: 'asc' } },
        { lineId: 'asc' },
      ],
    });

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    let opening = new Decimal(0);
    let running = new Decimal(0);
    const periodLines: Array<{
      lineId: string;
      entryId: string;
      entryNumber: string;
      entryDate: string;
      referenceType: string | null;
      referenceId: string | null;
      description: string | null;
      entryType: 'DEBIT' | 'CREDIT';
      debit: number;
      credit: number;
      runningBalance: number;
    }> = [];

    for (const line of lines) {
      const amount = line.amount.toString();
      const delta = line.entryType === 'DEBIT' ? new Decimal(amount) : new Decimal(amount).negated();
      if (line.entry.entryDate < fromDate) {
        opening = opening.plus(delta);
        running = running.plus(delta);
        continue;
      }
      running = running.plus(delta);
      periodLines.push({
        lineId: line.lineId,
        entryId: line.entryId,
        entryNumber: line.entry.entryNumber,
        entryDate: line.entry.entryDate.toISOString().slice(0, 10),
        referenceType: line.entry.referenceType,
        referenceId: line.entry.referenceId,
        description: line.description,
        entryType: line.entryType,
        debit: line.entryType === 'DEBIT' ? moneyToNumber(amount) : 0,
        credit: line.entryType === 'CREDIT' ? moneyToNumber(amount) : 0,
        runningBalance: moneyToNumber(running),
      });
    }

    res.status(200).json({
      accountId: account.accountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      from,
      to,
      openingBalance: moneyToNumber(opening),
      closingBalance: moneyToNumber(running),
      lines: periodLines,
    });
  },
);

/** GET /reports/profit-and-loss?from=&to= — posted revenue/expense performance (excludes year-end closing entries). */
reportRouter.get('/profit-and-loss', requirePermission('reports:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const { from, to } = financialStatementFilterSchema.parse(req.query);
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      entry: {
        companyId,
        status: 'POSTED',
        entryDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        referenceType: { not: 'YEAR_END_CLOSE' },
      },
      account: { companyId, accountType: { in: ['REVENUE', 'EXPENSE'] } },
    },
    select: {
      entryType: true,
      amount: true,
      account: { select: { accountId: true, accountCode: true, accountName: true, accountType: true } },
    },
  });

  const revenueMap = new Map<string, { accountId: string; accountCode: string; accountName: string; amount: Decimal }>();
  const expenseMap = new Map<string, { accountId: string; accountCode: string; accountName: string; amount: Decimal }>();
  for (const line of lines) {
    const map = line.account.accountType === 'REVENUE' ? revenueMap : expenseMap;
    const row = map.get(line.account.accountId) ?? {
      accountId: line.account.accountId,
      accountCode: line.account.accountCode,
      accountName: line.account.accountName,
      amount: new Decimal(0),
    };
    const amount = line.amount.toString();
    if (line.account.accountType === 'REVENUE') {
      row.amount = line.entryType === 'CREDIT' ? row.amount.plus(amount) : row.amount.minus(amount);
    } else {
      row.amount = line.entryType === 'DEBIT' ? row.amount.plus(amount) : row.amount.minus(amount);
    }
    map.set(line.account.accountId, row);
  }

  const toRows = (map: typeof revenueMap) =>
    [...map.values()]
      .map((r) => ({ accountId: r.accountId, accountCode: r.accountCode, accountName: r.accountName, amount: moneyToNumber(r.amount) }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const revenue = toRows(revenueMap);
  const expenses = toRows(expenseMap);
  const totalRevenue = moneyToNumber(sumMoney(revenue.map((r) => r.amount)));
  const totalExpenses = moneyToNumber(sumMoney(expenses.map((r) => r.amount)));
  res.status(200).json({
    from,
    to,
    revenue,
    expenses,
    totalRevenue,
    totalExpenses,
    netIncome: moneyToNumber(money(totalRevenue).minus(totalExpenses)),
  });
});

/** GET /reports/balance-sheet?asOf= — assets, liabilities, equity and current earnings as of date. */
reportRouter.get('/balance-sheet', requirePermission('reports:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const { asOf } = balanceSheetFilterSchema.parse(req.query);
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      entry: { companyId, status: 'POSTED', entryDate: { lte: new Date(`${asOf}T00:00:00.000Z`) } },
    },
    select: {
      entryType: true,
      amount: true,
      account: { select: { accountId: true, accountCode: true, accountName: true, accountType: true } },
    },
  });

  const byAccount = new Map<string, { accountId: string; accountCode: string; accountName: string; accountType: string; debit: Decimal; credit: Decimal }>();
  for (const line of lines) {
    const row = byAccount.get(line.account.accountId) ?? {
      accountId: line.account.accountId,
      accountCode: line.account.accountCode,
      accountName: line.account.accountName,
      accountType: line.account.accountType,
      debit: new Decimal(0),
      credit: new Decimal(0),
    };
    const amount = line.amount.toString();
    if (line.entryType === 'DEBIT') row.debit = row.debit.plus(amount);
    else row.credit = row.credit.plus(amount);
    byAccount.set(line.account.accountId, row);
  }

  const sectionRows = (types: string[], creditNormal: boolean) =>
    [...byAccount.values()]
      .filter((a) => types.includes(a.accountType))
      .map((a) => ({
        accountId: a.accountId,
        accountCode: a.accountCode,
        accountName: a.accountName,
        amount: moneyToNumber(creditNormal ? a.credit.minus(a.debit) : a.debit.minus(a.credit)),
      }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const assets = sectionRows(['ASSET'], false);
  const liabilities = sectionRows(['LIABILITY'], true);
  const equityAccounts = sectionRows(['EQUITY'], true);

  // Current earnings = net income from revenue/expense balances as-of (0 after year-end close).
  let revenueNet = new Decimal(0);
  let expenseNet = new Decimal(0);
  for (const a of byAccount.values()) {
    if (a.accountType === 'REVENUE') revenueNet = revenueNet.plus(a.credit.minus(a.debit));
    if (a.accountType === 'EXPENSE') expenseNet = expenseNet.plus(a.debit.minus(a.credit));
  }
  const currentEarnings = moneyToNumber(revenueNet.minus(expenseNet));
  const equityLines = currentEarnings !== 0
    ? [...equityAccounts, { accountId: 'current-earnings', accountCode: '', accountName: 'Current Year Earnings', amount: currentEarnings }]
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.accountName.localeCompare(b.accountName))
    : equityAccounts;

  const totalAssets = moneyToNumber(sumMoney(assets.map((r) => r.amount)));
  const totalLiabilities = moneyToNumber(sumMoney(liabilities.map((r) => r.amount)));
  const totalEquity = moneyToNumber(sumMoney(equityLines.map((r) => r.amount)));
  const totalLiabilitiesAndEquity = moneyToNumber(money(totalLiabilities).plus(totalEquity));
  const difference = moneyToNumber(money(totalAssets).minus(totalLiabilitiesAndEquity));
  res.status(200).json({
    asOf,
    assets: { lines: assets, total: totalAssets },
    liabilities: { lines: liabilities, total: totalLiabilities },
    equity: { lines: equityLines, total: totalEquity },
    totalLiabilitiesAndEquity,
    balanced: difference === 0,
    difference,
  });
});

/** GET /reports/cash-flow?from=&to= — cash movement summary by operating/investing/financing activity. */
reportRouter.get('/cash-flow', requirePermission('reports:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const { from, to } = financialStatementFilterSchema.parse(req.query);

  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId },
    select: { accountId: true, accountCode: true, accountType: true, parentAccountId: true },
  });
  const byId = new Map(accounts.map((a) => [a.accountId, a]));
  // Cash & cash equivalents: 1000 subtree (Cash and Bank and children like Petty Cash).
  const cashIds = new Set<string>();
  const root1000 = accounts.find((a) => a.accountCode === '1000');
  if (root1000) {
    cashIds.add(root1000.accountId);
    for (const a of accounts) {
      if (a.parentAccountId === root1000.accountId) cashIds.add(a.accountId);
    }
  } else {
    for (const a of accounts) if (a.accountCode === '1010') cashIds.add(a.accountId);
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const entries = await prisma.journalEntry.findMany({
    where: { companyId, status: 'POSTED', entryDate: { lte: toDate } },
    select: {
      entryId: true,
      entryDate: true,
      referenceType: true,
      lines: { select: { accountId: true, entryType: true, amount: true } },
    },
    orderBy: { entryDate: 'asc' },
  });

  let openingCash = new Decimal(0);
  const operating: { label: string; amount: number; referenceType?: string | null }[] = [];
  const investing: { label: string; amount: number; referenceType?: string | null }[] = [];
  const financing: { label: string; amount: number; referenceType?: string | null }[] = [];

  const classify = (entryLines: typeof entries[number]['lines']): 'operating' | 'investing' | 'financing' => {
    const nonCash = entryLines
      .filter((l) => !cashIds.has(l.accountId))
      .map((l) => byId.get(l.accountId))
      .filter((a): a is NonNullable<typeof a> => !!a);
    if (nonCash.some((a) => a.accountType === 'EQUITY')) return 'financing';
    if (nonCash.some((a) => a.accountType === 'REVENUE' || a.accountType === 'EXPENSE' || a.accountType === 'LIABILITY')) return 'operating';
    if (nonCash.some((a) => a.accountType === 'ASSET')) return 'operating';
    return 'investing';
  };

  for (const entry of entries) {
    let cashDelta = new Decimal(0);
    for (const line of entry.lines) {
      if (!cashIds.has(line.accountId)) continue;
      const amount = line.amount.toString();
      cashDelta = line.entryType === 'DEBIT' ? cashDelta.plus(amount) : cashDelta.minus(amount);
    }
    if (cashDelta.isZero()) continue;
    if (entry.entryDate < fromDate) {
      openingCash = openingCash.plus(cashDelta);
      continue;
    }
    const bucket = classify(entry.lines);
    const item = { label: entry.referenceType ?? 'Journal entry', amount: moneyToNumber(cashDelta), referenceType: entry.referenceType };
    if (bucket === 'operating') operating.push(item);
    else if (bucket === 'financing') financing.push(item);
    else investing.push(item);
  }

  const sumItems = (items: { amount: number }[]) => moneyToNumber(sumMoney(items.map((i) => i.amount)));
  const operatingTotal = sumItems(operating);
  const investingTotal = sumItems(investing);
  const financingTotal = sumItems(financing);
  const netChange = moneyToNumber(money(operatingTotal).plus(investingTotal).plus(financingTotal));
  const closingCash = moneyToNumber(openingCash.plus(netChange));
  res.status(200).json({
    from,
    to,
    openingCash: moneyToNumber(openingCash),
    closingCash,
    netChange,
    operating: { lines: operating, total: operatingTotal },
    investing: { lines: investing, total: investingTotal },
    financing: { lines: financing, total: financingTotal },
  });
});

/** GET /reports/dashboard — counters + recent journals + low stock. */
reportRouter.get('/dashboard', requirePermission('reports:read'), async (req, res) => {
  const companyId = req.user!.companyId;

  const [accountsCount, productsCount, warehousesCount, statusCounts, stock, recentJournalsRaw] =
    await Promise.all([
      prisma.chartOfAccount.count({ where: { companyId } }),
      prisma.product.count({ where: { companyId } }),
      prisma.warehouse.count({ where: { companyId } }),
      prisma.journalEntry.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      prisma.inventoryStock.findMany({
        where: { companyId },
        include: {
          product: { select: { sku: true, name: true, reorderThreshold: true } },
          warehouse: { select: { code: true, name: true } },
        },
      }),
      prisma.journalEntry.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: entryInclude,
      }),
    ]);

  const draftJournals = Number(statusCounts.find((s) => s.status === 'DRAFT')?._count._all ?? 0);
  const postedJournals = Number(statusCounts.find((s) => s.status === 'POSTED')?._count._all ?? 0);

  const lowStock = stock
    .filter((s) => s.quantityOnHand <= s.product.reorderThreshold)
    .sort((a, b) => a.product.sku.localeCompare(b.product.sku))
    .slice(0, 5);

  res.status(200).json({
    accountsCount,
    productsCount,
    warehousesCount,
    journalsCount:
      draftJournals +
      postedJournals +
      Number(statusCounts.find((s) => s.status === 'VOIDED')?._count._all ?? 0),
    draftJournals,
    postedJournals,
    lowStockCount: stock.filter((s) => s.quantityOnHand <= s.product.reorderThreshold).length,
    totalStockUnits: stock.reduce((sum, s) => sum + s.quantityOnHand, 0),
    recentJournals: recentJournalsRaw.map((entry) => serializeEntry(entry)),
    lowStock: lowStock.map((s) => ({
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
    })),
  });
});
