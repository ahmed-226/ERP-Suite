import { Router } from 'express';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  type Warehouse,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import type { Warehouse as WarehouseModel } from '../../generated/prisma/client';

export const warehouseRouter = Router();

const serialize = (w: WarehouseModel): Warehouse => ({
  warehouseId: w.warehouseId,
  companyId: w.companyId,
  code: w.code,
  name: w.name,
  locationAddress: w.locationAddress,
  isActive: w.isActive,
  createdAt: w.createdAt.toISOString(),
});

warehouseRouter.use(requireAuth);

/** GET /warehouses?search=&active= */
warehouseRouter.get('/', requirePermission('warehouses:read'), async (req, res) => {
  const filter = req.query as { search?: string; active?: string };
  const warehouses = await prisma.warehouse.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(filter.active === 'true' ? { isActive: true } : filter.active === 'false' ? { isActive: false } : {}),
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search, mode: 'insensitive' } }, { code: { contains: filter.search } }] }
        : {}),
    },
    orderBy: { code: 'asc' },
  });
  res.status(200).json(warehouses.map(serialize));
});

warehouseRouter.get('/:warehouseId', requirePermission('warehouses:read'), async (req, res) => {
  const warehouseId = req.params.warehouseId as string;
  const warehouse = await prisma.warehouse.findFirst({
    where: { warehouseId, companyId: req.user!.companyId },
  });
  if (!warehouse) throw notFound('Warehouse');
  res.status(200).json(serialize(warehouse));
});

warehouseRouter.post('/', requirePermission('warehouses:write'), async (req, res) => {
  const input = createWarehouseSchema.parse(req.body);
  const duplicate = await prisma.warehouse.findFirst({
    where: { companyId: req.user!.companyId, code: input.code },
    select: { warehouseId: true },
  });
  if (duplicate) throw new ApiError(409, 'DUPLICATE', `Warehouse code ${input.code} already exists`);
  const warehouse = await prisma.warehouse.create({
    data: {
      companyId: req.user!.companyId,
      code: input.code,
      name: input.name,
      locationAddress: input.locationAddress ?? null,
      isActive: input.isActive ?? true,
    },
  });
  res.status(201).json(serialize(warehouse));
});

warehouseRouter.patch('/:warehouseId', requirePermission('warehouses:write'), async (req, res) => {
  const input = updateWarehouseSchema.parse(req.body);
  const warehouseId = req.params.warehouseId as string;
  const existing = await prisma.warehouse.findFirst({
    where: { warehouseId, companyId: req.user!.companyId },
  });
  if (!existing) throw notFound('Warehouse');
  const warehouse = await prisma.warehouse.update({ where: { warehouseId }, data: input });
  res.status(200).json(serialize(warehouse));
});

warehouseRouter.delete('/:warehouseId', requirePermission('warehouses:write'), async (req, res) => {
  const warehouseId = req.params.warehouseId as string;
  const existing = await prisma.warehouse.findFirst({
    where: { warehouseId, companyId: req.user!.companyId },
  });
  if (!existing) throw notFound('Warehouse');
  const inUse =
    (await prisma.inventoryTransaction.count({ where: { warehouseId } })) > 0 ||
    (await prisma.inventoryStock.count({ where: { warehouseId } })) > 0;
  if (inUse) throw new ApiError(409, 'IN_USE', 'Warehouse has inventory history');
  await prisma.warehouse.delete({ where: { warehouseId } });
  res.status(204).send();
});
