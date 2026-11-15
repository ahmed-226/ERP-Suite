import { Router } from 'express';
import { createAccountSchema, updateAccountSchema, type Account } from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import type { ChartOfAccount } from '../../generated/prisma/client';

export const accountRouter = Router();

const serialize = (a: ChartOfAccount): Account => ({
  accountId: a.accountId,
  companyId: a.companyId,
  accountCode: a.accountCode,
  accountName: a.accountName,
  accountType: a.accountType,
  parentAccountId: a.parentAccountId,
  isActive: a.isActive,
  createdAt: a.createdAt.toISOString(),
});

accountRouter.use(requireAuth);

/** GET /accounts?type=&active=&search= */
accountRouter.get('/', requirePermission('accounts:read'), async (req, res) => {
  const { type, active, search } = req.query as { type?: string; active?: string; search?: string };
  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(type ? { accountType: type as Account['accountType'] } : {}),
      ...(active === 'true' ? { isActive: true } : active === 'false' ? { isActive: false } : {}),
      ...(search
        ? { OR: [{ accountName: { contains: search, mode: 'insensitive' } }, { accountCode: { contains: search } }] }
        : {}),
    },
    orderBy: { accountCode: 'asc' },
  });  res.status(200).json(accounts.map(serialize));
});

accountRouter.get('/:accountId', requirePermission('accounts:read'), async (req, res) => {
  const accountId = req.params.accountId as string;
  const account = await prisma.chartOfAccount.findFirst({
    where: { accountId, companyId: req.user!.companyId },
  });
  if (!account) throw notFound('Account');
  res.status(200).json(serialize(account));
});

accountRouter.post('/', requirePermission('accounts:write'), async (req, res) => {
  const input = createAccountSchema.parse(req.body);
  if (input.parentAccountId) {
    await assertAccountInCompany(req.user!.companyId, input.parentAccountId);
  }
  const duplicate = await prisma.chartOfAccount.findFirst({
    where: { companyId: req.user!.companyId, accountCode: input.accountCode },
    select: { accountId: true },
  });
  if (duplicate) {
    throw new ApiError(409, 'DUPLICATE', `Account code ${input.accountCode} already exists`);
  }
  const account = await prisma.chartOfAccount.create({
    data: {
      companyId: req.user!.companyId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      accountType: input.accountType,
      parentAccountId: input.parentAccountId ?? null,
      isActive: input.isActive ?? true,
    },
  });
  res.status(201).json(serialize(account));
});

accountRouter.patch('/:accountId', requirePermission('accounts:write'), async (req, res) => {
  const input = updateAccountSchema.parse(req.body);
  const accountId = req.params.accountId as string;
  const account = await assertAccountInCompany(req.user!.companyId, accountId);
  if (input.parentAccountId) {
    await assertAccountInCompany(req.user!.companyId, input.parentAccountId);
    await assertNoCycle(req.user!.companyId, accountId, input.parentAccountId);
  }
  if (input.accountType !== undefined && input.accountType !== account.accountType) {
    const lines = await prisma.journalEntryLine.count({ where: { accountId } });
    if (lines > 0) {
      throw new ApiError(
        409,
        'ACCOUNT_TYPE_IN_USE',
        'Cannot change the type of an account that has journal lines',
      );
    }
  }
  const updated = await prisma.chartOfAccount.update({
    where: { accountId },
    data: {
      ...(input.accountCode !== undefined ? { accountCode: input.accountCode } : {}),
      ...(input.accountName !== undefined ? { accountName: input.accountName } : {}),
      ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
      ...(input.parentAccountId !== undefined ? { parentAccountId: input.parentAccountId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  res.status(200).json(serialize(updated));
});

accountRouter.delete('/:accountId', requirePermission('accounts:write'), async (req, res) => {
  const accountId = req.params.accountId as string;
  await assertAccountInCompany(req.user!.companyId, accountId);
  const lines = await prisma.journalEntryLine.count({ where: { accountId } });
  const children = await prisma.chartOfAccount.count({ where: { parentAccountId: accountId } });
  if (lines > 0 || children > 0) {
    throw new ApiError(
      409,
      'IN_USE',
      children > 0 ? 'Account has child accounts' : 'Account has journal lines',
    );
  }
  await prisma.chartOfAccount.delete({ where: { accountId } });
  res.status(204).send();
});

async function assertAccountInCompany(companyId: string, accountId: string) {
  const account = await prisma.chartOfAccount.findFirst({
    where: { accountId, companyId },
  });
  if (!account) throw notFound('Account');
  return account;
}

/**
 * Walk the proposed parent's ancestor chain: if it reaches `accountId`, the
 * assignment would detach the subtree into a cycle that the client tree cannot
 * render. Self-parenting is the first iteration of the same walk.
 */
async function assertNoCycle(
  companyId: string,
  accountId: string,
  parentAccountId: string,
): Promise<void> {
  let cursor: string | null = parentAccountId;
  while (cursor) {
    if (cursor === accountId) {
      throw new ApiError(422, 'INVALID_PARENT', 'Parent assignment would create a cycle');
    }
    const node: { parentAccountId: string | null } | null = await prisma.chartOfAccount.findFirst({
      where: { accountId: cursor, companyId },
      select: { parentAccountId: true },
    });
    cursor = node?.parentAccountId ?? null;
  }
}
