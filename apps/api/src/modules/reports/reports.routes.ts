import { Router } from 'express';
import {
  Decimal,
  SYSTEM_ACCOUNT_CODES,
  inventoryAgingFilterSchema,
  inventoryMovementSummaryFilterSchema,
  money,
  moneyToNumber,
  sumMoney,
  trialBalanceFilterSchema,
} from '@erp/shared';
import { prisma } from '../../db/db';
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
