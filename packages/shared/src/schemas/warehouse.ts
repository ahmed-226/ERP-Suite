import { z } from 'zod';

export const createWarehouseSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  locationAddress: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = createWarehouseSchema.partial();
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export interface Warehouse {
  warehouseId: string;
  companyId: string;
  code: string;
  name: string;
  locationAddress: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface WarehouseFilter {
  search?: string;
  active?: boolean;
}
