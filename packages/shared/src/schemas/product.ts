import { z } from 'zod';

export const createProductSchema = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(150),
  description: z.string().max(1000).nullable().optional(),
  unitOfMeasure: z.string().min(1).max(20).optional(),
  reorderThreshold: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export interface Product {
  productId: string;
  companyId: string;
  sku: string;
  name: string;
  description: string | null;
  unitOfMeasure: string;
  reorderThreshold: number;
  isActive: boolean;
  createdAt: string;
}

export interface ProductFilter {
  search?: string;
  active?: boolean;
}
