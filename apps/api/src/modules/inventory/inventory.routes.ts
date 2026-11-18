import { Router } from 'express';
import type { Request } from 'express';
import {
  adjustmentSchema,
  createStocktakeSchema,
  issueSchema,
  money,
  movementFilterSchema,
  receiptSchema,
  signedMovementQuantity,
  stockFilterSchema,
  transferSchema,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { assertPeriodOpen } from '../fiscal/fiscal.service';
import {
  applyStockDeltas,
  lockProductCosting,
  movementInclude,
  serializeMovement,
  stockInclude,
  type PrismaTx,
} from './inventory.view';
import { postInventoryJournal, systemAccountIds } from '../integration/gl-posting';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

function idempotencyKey(req: Request): string | null {
  const value = req.header('idempotency-key');
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function withInventoryIdempotency<T>(
  req: Request,
  operation: string,
  work: (tx: PrismaTx) => Promise<T>,
): Promise<{ status: number; body: T }> {
  const key = idempotencyKey(req);
  if (!key) {
    const body = await prisma.$transaction((tx) => work(tx));
    return { status: 201, body };
  }

  const companyId = req.user!.companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('erp-inventory-idempotency'), hashtext(${companyId}), hashtext(${key}))`;
    const existing = await tx.inventoryIdempotencyKey.findUnique({
      where: { companyId_key: { companyId, key } },
      select: { statusCode: true, response: true },
    });
    if (existing) {
      return { status: existing.statusCode, body: existing.response as T };
    }
    const body = await work(tx);
    await tx.inventoryIdempotencyKey.create({
      data: {
        companyId,
        key,
        operation,
        statusCode: 201,
        response: body as object,
      },
    });
    return { status: 201, body };
  });
}

async function assertProductInCompany(companyId: string, productId: string): Promise<void> {
  const exists = await prisma.product.findFirst({
    where: { productId, companyId },
    select: { productId: true },
  });
  if (!exists) throw notFound('Product');
}

async function assertWarehouseInCompany(companyId: string, warehouseId: string): Promise<void> {
  const exists = await prisma.warehouse.findFirst({
    where: { warehouseId, companyId },
    select: { warehouseId: true },
  });
  if (!exists) throw notFound('Warehouse');
}

/** GET /inventory/stock?productId=&warehouseId=&lowStock=&search= */
inventoryRouter.get('/stock', requirePermission('inventory:read'), async (req, res) => {
  const filter = stockFilterSchema.parse(req.query);
  const rows = await prisma.inventoryStock.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
    },
    include: stockInclude,
  });
  let stock = rows.map((r) => ({ ...r, sku: r.product.sku, productName: r.product.name }));
  if (filter.lowStock) stock = stock.filter((s) => s.quantityOnHand <= s.product.reorderThreshold);
  if (filter.search) {
    const q = String(filter.search).toLowerCase();
    stock = stock.filter((s) => `${s.sku} ${s.productName}`.toLowerCase().includes(q));
  }
  res.status(200).json(
    stock
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((s) => ({
        ...s,
        warehouseCode: s.warehouse.code,
        warehouseName: s.warehouse.name,
      })),
  );
});

/** GET /inventory/movements?productId=&warehouseId=&movementType=&from=&to= */
inventoryRouter.get('/movements', requirePermission('inventory:read'), async (req, res) => {
  const filter = movementFilterSchema.parse(req.query);
  const movements = await prisma.inventoryTransaction.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
      ...(filter.movementType ? { movementType: filter.movementType } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
              ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: movementInclude,
  });
  res.status(200).json(movements.map(serializeMovement));
});

/** Creates the movement record + applies the stock delta atomically. */
function recordMovement(
  tx: PrismaTx,
  args: {
    companyId: string;
    productId: string;
    warehouseId: string;
    movementType: 'GOODS_RECEIPT' | 'SALES_ISSUE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT';
    quantity: number;
    unitCost: number;
    referenceId: string | null;
    userId: string;
  },
) {
  return tx.inventoryTransaction.create({
    data: {
      companyId: args.companyId,
      productId: args.productId,
      warehouseId: args.warehouseId,
      movementType: args.movementType,
      quantity: args.quantity,
      unitCost: args.unitCost,
      referenceId: args.referenceId,
      createdBy: args.userId,
    },
    include: movementInclude,
  });
}

/** POST /inventory/receipts — stock in. */
inventoryRouter.post('/receipts', requirePermission('inventory:write'), async (req, res) => {
  const input = receiptSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const result = await withInventoryIdempotency(req, 'receipt', async (tx) => {
    await assertPeriodOpen(tx, companyId, new Date().toISOString().slice(0, 10));
    // Moving average is company-wide: blend the received cost into the value of
    // all on-hand units before the stock delta lands. Locking the product first
    // keeps concurrent receipts from overwriting each other's blend.
    await lockProductCosting(tx, input.productId);
    const product = await tx.product.findUniqueOrThrow({
      where: { productId: input.productId },
      select: { averageCost: true },
    });
    const onHand = await tx.inventoryStock.aggregate({
      where: { companyId, productId: input.productId },
      _sum: { quantityOnHand: true },
    });
    const existingQty = onHand._sum.quantityOnHand ?? 0;
    const newAverage = money(existingQty)
      .times(product.averageCost.toString())
      .plus(money(input.quantity).times(input.unitCost))
      .dividedBy(existingQty + input.quantity);
    await tx.product.update({
      where: { productId: input.productId },
      data: { averageCost: newAverage },
    });

    await applyStockDeltas(tx, {
      companyId,
      productId: input.productId,
      deltas: [{ warehouseId: input.warehouseId, quantityDelta: input.quantity }],
    });
    const created = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'GOODS_RECEIPT',
      quantity: signedMovementQuantity('GOODS_RECEIPT', input.quantity),
      unitCost: input.unitCost,
      referenceId: input.referenceId ?? null,
      userId: req.user!.userId,
    });
    // Inventory → GL (WORKFLOWS.md §7): DR Inventory / CR Accounts Payable.
    const amount = money(input.quantity).times(input.unitCost);
    if (!amount.isZero()) {
      const accounts = await systemAccountIds(tx, companyId);
      await postInventoryJournal(tx, {
        companyId,
        userId: req.user!.userId,
        entryDate: new Date(),
        referenceType: 'INVENTORY_RECEIPT',
        referenceId: created.transactionId,
        debitAccountId: accounts.inventory,
        creditAccountId: accounts.accountsPayable,
        amount,
      });
    }
    return serializeMovement(created);
  });
  res.status(result.status).json(result.body);
});

/** POST /inventory/issues — stock out; fails on insufficient stock. */
inventoryRouter.post('/issues', requirePermission('inventory:write'), async (req, res) => {
  const input = issueSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const result = await withInventoryIdempotency(req, 'issue', async (tx) => {
    await assertPeriodOpen(tx, companyId, new Date().toISOString().slice(0, 10));
    const product = await tx.product.findUniqueOrThrow({
      where: { productId: input.productId },
      select: { averageCost: true },
    });
    const unitCost = Number(product.averageCost);
    await applyStockDeltas(tx, {
      companyId,
      productId: input.productId,
      deltas: [{ warehouseId: input.warehouseId, quantityDelta: -input.quantity }],
    });
    const created = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'SALES_ISSUE',
      quantity: signedMovementQuantity('SALES_ISSUE', input.quantity),
      unitCost,
      referenceId: input.referenceId ?? null,
      userId: req.user!.userId,
    });
    // Inventory → GL (WORKFLOWS.md §8): DR COGS / CR Inventory, at valuation cost.
    const amount = money(input.quantity).times(unitCost);
    if (!amount.isZero()) {
      const accounts = await systemAccountIds(tx, companyId);
      await postInventoryJournal(tx, {
        companyId,
        userId: req.user!.userId,
        entryDate: new Date(),
        referenceType: 'SALES_ISSUE',
        referenceId: created.transactionId,
        debitAccountId: accounts.costOfGoodsSold,
        creditAccountId: accounts.inventory,
        amount,
      });
    }
    return serializeMovement(created);
  });
  res.status(result.status).json(result.body);
});

/** POST /inventory/transfers — TRANSFER_OUT + TRANSFER_IN pair. */
inventoryRouter.post('/transfers', requirePermission('inventory:write'), async (req, res) => {
  const input = transferSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.fromWarehouseId);
  await assertWarehouseInCompany(companyId, input.toWarehouseId);

  const result = await withInventoryIdempotency(req, 'transfer', async (tx) => {
    await assertPeriodOpen(tx, companyId, new Date().toISOString().slice(0, 10));
    const product = await tx.product.findUniqueOrThrow({
      where: { productId: input.productId },
      select: { averageCost: true },
    });
    const unitCost = Number(product.averageCost);
    await applyStockDeltas(tx, {
      companyId,
      productId: input.productId,
      deltas: [
        { warehouseId: input.fromWarehouseId, quantityDelta: -input.quantity },
        { warehouseId: input.toWarehouseId, quantityDelta: input.quantity },
      ],
    });
    const out = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      movementType: 'TRANSFER_OUT',
      quantity: signedMovementQuantity('TRANSFER_OUT', input.quantity),
      unitCost,
      referenceId: null,
      userId: req.user!.userId,
    });
    const inc = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      movementType: 'TRANSFER_IN',
      quantity: signedMovementQuantity('TRANSFER_IN', input.quantity),
      unitCost,
      referenceId: out.transactionId,
      userId: req.user!.userId,
    });
    return [out, inc].map(serializeMovement);
  });
  res.status(result.status).json(result.body);
});

/** POST /inventory/adjustments — signed delta with a reason. */
inventoryRouter.post('/adjustments', requirePermission('inventory:write'), async (req, res) => {
  const input = adjustmentSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const result = await withInventoryIdempotency(req, 'adjustment', async (tx) => {
    await assertPeriodOpen(tx, companyId, new Date().toISOString().slice(0, 10));
    const product = await tx.product.findUniqueOrThrow({
      where: { productId: input.productId },
      select: { averageCost: true },
    });
    const unitCost = Number(product.averageCost);
    await applyStockDeltas(tx, {
      companyId,
      productId: input.productId,
      deltas: [{ warehouseId: input.warehouseId, quantityDelta: input.quantityDelta }],
    });
    const created = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'ADJUSTMENT',
      quantity: input.quantityDelta,
      unitCost,
      referenceId: null,
      userId: req.user!.userId,
    });
    // Inventory → GL (WORKFLOWS.md §10): a write-off expenses the lost value,
    // a gain brings it back. Zero-value adjustments post nothing (documented).
    const amount = money(Math.abs(input.quantityDelta)).times(unitCost);
    if (!amount.isZero()) {
      const accounts = await systemAccountIds(tx, companyId);
      const writeOff = input.quantityDelta < 0;
      await postInventoryJournal(tx, {
        companyId,
        userId: req.user!.userId,
        entryDate: new Date(),
        referenceType: 'ADJUSTMENT',
        referenceId: created.transactionId,
        debitAccountId: writeOff ? accounts.operatingExpenses : accounts.inventory,
        creditAccountId: writeOff ? accounts.inventory : accounts.operatingExpenses,
        amount,
      });
    }
    return serializeMovement(created);
  });
  res.status(result.status).json(result.body);
});

const stocktakeInclude = {
  warehouse: { select: { code: true, name: true } },
  creator: { select: { fullName: true } },
  applier: { select: { fullName: true } },
  lines: {
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { product: { sku: 'asc' as const } },
  },
} as const;

function serializeStocktake(st: {
  stocktakeId: string;
  warehouseId: string;
  status: string;
  notes: string | null;
  createdBy: string;
  appliedBy: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  warehouse: { code: string; name: string };
  creator: { fullName: string };
  applier: { fullName: string } | null;
  lines: Array<{
    lineId: string;
    productId: string;
    systemQuantity: number;
    countedQuantity: number;
    variance: number;
    product: { sku: string; name: string };
  }>;
}) {
  return {
    stocktakeId: st.stocktakeId,
    warehouseId: st.warehouseId,
    warehouseCode: st.warehouse.code,
    warehouseName: st.warehouse.name,
    status: st.status,
    notes: st.notes,
    createdBy: st.createdBy,
    createdByName: st.creator.fullName,
    appliedBy: st.appliedBy,
    appliedByName: st.applier?.fullName ?? null,
    appliedAt: st.appliedAt?.toISOString() ?? null,
    createdAt: st.createdAt.toISOString(),
    lines: st.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      sku: line.product.sku,
      productName: line.product.name,
      systemQuantity: line.systemQuantity,
      countedQuantity: line.countedQuantity,
      variance: line.variance,
    })),
  };
}

/** GET /inventory/stocktakes — list count sheets for the company. */
inventoryRouter.get('/stocktakes', requirePermission('inventory:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
  const stocktakes = await prisma.stocktake.findMany({
    where: { companyId, ...(warehouseId ? { warehouseId } : {}) },
    include: stocktakeInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.status(200).json(stocktakes.map(serializeStocktake));
});

/** GET /inventory/stocktakes/:stocktakeId */
inventoryRouter.get('/stocktakes/:stocktakeId', requirePermission('inventory:read'), async (req, res) => {
  const stocktake = await prisma.stocktake.findFirst({
    where: { stocktakeId: req.params.stocktakeId, companyId: req.user!.companyId },
    include: stocktakeInclude,
  });
  if (!stocktake) throw notFound('Stocktake');
  res.status(200).json(serializeStocktake(stocktake));
});

/** POST /inventory/stocktakes — create a draft count sheet with captured system quantities. */
inventoryRouter.post('/stocktakes', requirePermission('inventory:write'), async (req, res) => {
  const input = createStocktakeSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const productIds = input.lines.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new ApiError(422, 'DUPLICATE_PRODUCT', 'Each product can appear once per count sheet');
  }

  const products = await prisma.product.findMany({
    where: { companyId, productId: { in: productIds } },
    select: { productId: true },
  });
  if (products.length !== productIds.length) throw notFound('Product');

  const stockRows = await prisma.inventoryStock.findMany({
    where: { companyId, warehouseId: input.warehouseId, productId: { in: productIds } },
    select: { productId: true, quantityOnHand: true },
  });
  const onHandByProduct = new Map(stockRows.map((s) => [s.productId, s.quantityOnHand]));

  const created = await prisma.stocktake.create({
    data: {
      companyId,
      warehouseId: input.warehouseId,
      notes: input.notes ?? null,
      createdBy: req.user!.userId,
      lines: {
        create: input.lines.map((line) => {
          const systemQuantity = onHandByProduct.get(line.productId) ?? 0;
          return {
            productId: line.productId,
            systemQuantity,
            countedQuantity: line.countedQuantity,
            variance: line.countedQuantity - systemQuantity,
          };
        }),
      },
    },
    include: stocktakeInclude,
  });

  res.status(201).json(serializeStocktake(created));
});

/** POST /inventory/stocktakes/:stocktakeId/apply — approve and post adjustment movements/GL for variances. */
inventoryRouter.post(
  '/stocktakes/:stocktakeId/apply',
  requirePermission('inventory:write'),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.userId;
    const stocktakeId = req.params.stocktakeId;

    const applied = await prisma.$transaction(async (tx) => {
      await assertPeriodOpen(tx, companyId, new Date().toISOString().slice(0, 10));
      const stocktake = await tx.stocktake.findFirst({
        where: { stocktakeId, companyId },
        include: { lines: true, warehouse: { select: { code: true, name: true } } },
      });
      if (!stocktake) throw notFound('Stocktake');
      if (stocktake.status !== 'DRAFT') {
        throw new ApiError(409, 'STOCKTAKE_NOT_DRAFT', 'Only draft stocktakes can be applied');
      }

      // Apply recorded variances as adjustment movements (auditable, no direct ledger edits).
      for (const line of stocktake.lines) {
        if (line.variance === 0) continue;
        const product = await tx.product.findUniqueOrThrow({
          where: { productId: line.productId },
          select: { averageCost: true },
        });
        const unitCost = Number(product.averageCost);
        await applyStockDeltas(tx, {
          companyId,
          productId: line.productId,
          deltas: [{ warehouseId: stocktake.warehouseId, quantityDelta: line.variance }],
        });
        const created = await recordMovement(tx, {
          companyId,
          productId: line.productId,
          warehouseId: stocktake.warehouseId,
          movementType: 'ADJUSTMENT',
          quantity: line.variance,
          unitCost,
          referenceId: stocktake.stocktakeId,
          userId,
        });
        const amount = money(Math.abs(line.variance)).times(unitCost);
        if (!amount.isZero()) {
          const accounts = await systemAccountIds(tx, companyId);
          const writeOff = line.variance < 0;
          await postInventoryJournal(tx, {
            companyId,
            userId,
            entryDate: new Date(),
            referenceType: 'ADJUSTMENT',
            referenceId: created.transactionId,
            debitAccountId: writeOff ? accounts.operatingExpenses : accounts.inventory,
            creditAccountId: writeOff ? accounts.inventory : accounts.operatingExpenses,
            amount,
          });
        }
      }

      await tx.stocktake.update({
        where: { stocktakeId },
        data: { status: 'APPLIED', appliedBy: userId, appliedAt: new Date() },
      });

      return tx.stocktake.findUniqueOrThrow({
        where: { stocktakeId },
        include: stocktakeInclude,
      });
    });

    res.status(200).json(serializeStocktake(applied));
  },
);
