import { z } from 'zod';

/** A role with its flattened permission list (from the global catalog). */
export interface RoleInfo {
  roleId: string;
  code: string;
  name: string;
  permissions: string[];
}

/** A user as seen by the users & roles administration screen. */
export interface AdminUser {
  userId: string;
  companyId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: RoleInfo[];
}

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
