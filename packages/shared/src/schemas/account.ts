import { z } from 'zod';
import { ACCOUNT_TYPES, type AccountType } from '../constants';

export const createAccountSchema = z.object({
  accountCode: z.string().min(1).max(30),
  accountName: z.string().min(1).max(100),
  accountType: z.enum(ACCOUNT_TYPES),
  parentAccountId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = createAccountSchema.partial();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export interface Account {
  accountId: string;
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AccountFilter {
  type?: AccountType;
  active?: boolean;
  search?: string;
}
