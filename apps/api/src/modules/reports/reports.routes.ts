import { Router } from 'express';
import { prisma } from '../../db/db';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { entryInclude, serializeEntry } from '../journals/journal.view';

export const reportRouter = Router();

reportRouter.use(requireAuth);

/** GET /reports/trial-balance?from=&to= — posted entries only. */
reportRouter.get('/trial-balance', requirePermission('reports:read'), async (req, res) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId: req.user!.companyId,
      status: 'POSTED',
      entryDate: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T23:59:59.999Z`),
      },
    },
    select: { lines: { select: { accountId: true, entryType: true, amount: true, account: { select: { accountId: true, accountCode: true, accountName: true, accountType: true } } } } },
  });

  const rows = new Map<string, { accountId: string; accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>();
  for (const line of entries.flatMap((e) => e.lines)) {
    let row = rows.get(line.accountId);
    if (!row) {
      row = {
        accountId: line.accountId,
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        accountType: line.account.accountType,
        debit: 0,
        credit: 0,
      };
      rows.set(line.accountId, row);
    }
    if (line.entryType === 'DEBIT') row.debit += Number(line.amount);
    else row.credit += Number(line.amount);
  }
  res.status(200).json(
    [...rows.values()]
      .map((r) => ({ ...r, net: r.debit - r.credit }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
  );
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
        include: { product: { select: { sku: true, name: true, reorderThreshold: true } }, warehouse: { select: { code: true, name: true } } },
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
    journalsCount: draftJournals + postedJournals + Number(statusCounts.find((s) => s.status === 'VOIDED')?._count._all ?? 0),
    draftJournals,
    postedJournals,
    lowStockCount: stock.filter((s) => s.quantityOnHand <= s.product.reorderThreshold).length,
    totalStockUnits: stock.reduce((sum, s) => sum + s.quantityOnHand, 0),
    recentJournals: recentJournalsRaw.map(serializeEntry),
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
