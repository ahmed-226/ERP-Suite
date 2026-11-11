import { Router } from 'express';
import {
  createProductSchema,
  updateProductSchema,
  type Product,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import type { Product as ProductModel } from '../../generated/prisma/client';

export const productRouter = Router();

const serialize = (p: ProductModel): Product => ({
  productId: p.productId,
  companyId: p.companyId,
  sku: p.sku,
  name: p.name,
  description: p.description,
  unitOfMeasure: p.unitOfMeasure,
  reorderThreshold: p.reorderThreshold,
  isActive: p.isActive,
  createdAt: p.createdAt.toISOString(),
});

productRouter.use(requireAuth);

/** GET /products?search=&active= */
productRouter.get('/', requirePermission('products:read'), async (req, res) => {
  const filter = req.query as { search?: string; active?: string };
  const products = await prisma.product.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(filter.active === 'true' ? { isActive: true } : filter.active === 'false' ? { isActive: false } : {}),
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search, mode: 'insensitive' } }, { sku: { contains: filter.search } }] }
        : {}),
    },
    orderBy: { sku: 'asc' },
  });
  res.status(200).json(products.map(serialize));
});

productRouter.get('/:productId', requirePermission('products:read'), async (req, res) => {
  const productId = req.params.productId as string;
  const product = await prisma.product.findFirst({
    where: { productId, companyId: req.user!.companyId },
  });
  if (!product) throw notFound('Product');
  res.status(200).json(serialize(product));
});

productRouter.post('/', requirePermission('products:write'), async (req, res) => {
  const input = createProductSchema.parse(req.body);
  const duplicate = await prisma.product.findFirst({
    where: { companyId: req.user!.companyId, sku: input.sku },
    select: { productId: true },
  });
  if (duplicate) throw new ApiError(409, 'DUPLICATE', `SKU ${input.sku} already exists`);
  const product = await prisma.product.create({
    data: {
      companyId: req.user!.companyId,
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      unitOfMeasure: input.unitOfMeasure ?? 'PCS',
      reorderThreshold: input.reorderThreshold ?? 10,
      isActive: input.isActive ?? true,
    },
  });
  res.status(201).json(serialize(product));
});

productRouter.patch('/:productId', requirePermission('products:write'), async (req, res) => {
  const input = updateProductSchema.parse(req.body);
  const productId = req.params.productId as string;
  const existing = await prisma.product.findFirst({
    where: { productId, companyId: req.user!.companyId },
  });
  if (!existing) throw notFound('Product');
  const product = await prisma.product.update({ where: { productId }, data: input });
  res.status(200).json(serialize(product));
});

productRouter.delete('/:productId', requirePermission('products:write'), async (req, res) => {
  const productId = req.params.productId as string;
  const existing = await prisma.product.findFirst({
    where: { productId, companyId: req.user!.companyId },
  });
  if (!existing) throw notFound('Product');
  const inUse =
    (await prisma.inventoryTransaction.count({ where: { productId } })) > 0 ||
    (await prisma.inventoryStock.count({ where: { productId } })) > 0;
  if (inUse) throw new ApiError(409, 'IN_USE', 'Product has inventory history');
  await prisma.product.delete({ where: { productId } });
  res.status(204).send();
});
