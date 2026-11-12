import { Router } from 'express';
import {
  adjustmentSchema,
  issueSchema,
  receiptSchema,
  transferSchema,
  type MovementFilter,
  type StockFilter,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import {
  applyStockDelta,
  movementInclude,
  serializeMovement,
  stockInclude,
  type PrismaTx,
} from './inventory.view';
import { postInventoryJournal, systemAccountIds } from '../integration/gl-posting';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

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
  const filter = req.query as StockFilter;
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
  const filter = req.query as MovementFilter;
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

  const movement = await prisma.$transaction(async (tx) => {
    await applyStockDelta(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantityDelta: input.quantity,
    });
    const created = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'GOODS_RECEIPT',
      quantity: input.quantity,
      unitCost: input.unitCost,
      referenceId: input.referenceId ?? null,
      userId: req.user!.userId,
    });
    // Inventory → GL (WORKFLOWS.md §7): DR Inventory / CR Accounts Payable.
    if (input.quantity * input.unitCost > 0) {
      const accounts = await systemAccountIds(tx, companyId);
      await postInventoryJournal(tx, {
        companyId,
        userId: req.user!.userId,
        entryDate: new Date(),
        referenceType: 'INVENTORY_RECEIPT',
        referenceId: created.transactionId,
        debitAccountId: accounts.inventory,
        creditAccountId: accounts.accountsPayable,
        amount: input.quantity * input.unitCost,
      });
    }
    return created;
  });
  res.status(201).json(serializeMovement(movement));
});

/** POST /inventory/issues — stock out; fails on insufficient stock. */
inventoryRouter.post('/issues', requirePermission('inventory:write'), async (req, res) => {
  const input = issueSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const movement = await prisma.$transaction(async (tx) => {
    await applyStockDelta(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantityDelta: -input.quantity,
    });
    const created = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'SALES_ISSUE',
      quantity: input.quantity,
      unitCost: input.unitCost ?? 0,
      referenceId: input.referenceId ?? null,
      userId: req.user!.userId,
    });
    // Inventory → GL (WORKFLOWS.md §8): DR COGS / CR Inventory.
    const cost = input.unitCost ?? 0;
    if (input.quantity * cost > 0) {
      const accounts = await systemAccountIds(tx, companyId);
      await postInventoryJournal(tx, {
        companyId,
        userId: req.user!.userId,
        entryDate: new Date(),
        referenceType: 'SALES_ISSUE',
        referenceId: created.transactionId,
        debitAccountId: accounts.costOfGoodsSold,
        creditAccountId: accounts.inventory,
        amount: input.quantity * cost,
      });
    }
    return created;
  });
  res.status(201).json(serializeMovement(movement));
});

/** POST /inventory/transfers — TRANSFER_OUT + TRANSFER_IN pair. */
inventoryRouter.post('/transfers', requirePermission('inventory:write'), async (req, res) => {
  const input = transferSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.fromWarehouseId);
  await assertWarehouseInCompany(companyId, input.toWarehouseId);

  const movements = await prisma.$transaction(async (tx) => {
    await applyStockDelta(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      quantityDelta: -input.quantity,
    });
    await applyStockDelta(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      quantityDelta: input.quantity,
    });
    const out = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      movementType: 'TRANSFER_OUT',
      quantity: input.quantity,
      unitCost: 0,
      referenceId: null,
      userId: req.user!.userId,
    });
    const inc = await recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      movementType: 'TRANSFER_IN',
      quantity: input.quantity,
      unitCost: 0,
      referenceId: out.transactionId,
      userId: req.user!.userId,
    });
    return [out, inc];
  });
  res.status(201).json(movements.map(serializeMovement));
});

/** POST /inventory/adjustments — signed delta with a reason. */
inventoryRouter.post('/adjustments', requirePermission('inventory:write'), async (req, res) => {
  const input = adjustmentSchema.parse(req.body);
  const companyId = req.user!.companyId;
  await assertProductInCompany(companyId, input.productId);
  await assertWarehouseInCompany(companyId, input.warehouseId);

  const movement = await prisma.$transaction(async (tx) => {
    await applyStockDelta(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantityDelta: input.quantityDelta,
    });
    return recordMovement(tx, {
      companyId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      movementType: 'ADJUSTMENT',
      quantity: input.quantityDelta,
      unitCost: input.unitCost ?? 0,
      referenceId: null,
      userId: req.user!.userId,
    });
  });
  res.status(201).json(serializeMovement(movement));
});
