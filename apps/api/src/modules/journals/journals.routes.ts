import { Router } from 'express';
import {
  createJournalSchema,
  journalFilterSchema,
  moneyToNumber,
  REVERSAL_REFERENCE_TYPE,
  signedAmount,
  sumMoney,
  updateJournalSchema,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { entryInclude, entryWhere, nextEntryNumber, serializeEntry } from './journal.view';

export const journalRouter = Router();

journalRouter.use(requireAuth);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Every line must point at an active account owned by the caller's company.
 * Unknown and other-company ids both return 404 so ids cannot be probed.
 */
async function assertAccountsUsable(
  tx: Tx,
  companyId: string,
  lines: { accountId: string }[],
): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await tx.chartOfAccount.findMany({
    where: { accountId: { in: ids }, companyId },
    select: { accountId: true, accountCode: true, isActive: true },
  });
  const found = new Set(accounts.map((account) => account.accountId));
  const missing = ids.find((id) => !found.has(id));
  if (missing) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', `Account ${missing} not found`);
  }
  const inactive = accounts.filter((account) => !account.isActive);
  if (inactive.length > 0) {
    throw new ApiError(
      422,
      'ACCOUNT_INACTIVE',
      `Account ${inactive.map((account) => account.accountCode).join(', ')} is inactive`,
    );
  }
}

/** original entry id → its reversal entry id, for the given company. */
async function reversalLinks(companyId: string, entryIds?: string[]): Promise<Map<string, string>> {
  const reversals = await prisma.journalEntry.findMany({
    where: {
      companyId,
      referenceType: REVERSAL_REFERENCE_TYPE,
      referenceId: entryIds ? { in: entryIds } : { not: null },
    },
    select: { entryId: true, referenceId: true },
  });
  return new Map(reversals.map((reversal) => [reversal.referenceId as string, reversal.entryId]));
}

/** GET /journals?status=&referenceType=&from=&to=&search= */
journalRouter.get('/', requirePermission('journals:read'), async (req, res) => {
  const filter = journalFilterSchema.parse(req.query);
  const companyId = req.user!.companyId;
  const [entries, links] = await Promise.all([
    prisma.journalEntry.findMany({
      where: entryWhere(companyId, filter),
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      include: entryInclude,
    }),
    reversalLinks(companyId),
  ]);
  res.status(200).json(entries.map((entry) => serializeEntry(entry, links.get(entry.entryId) ?? null)));
});

journalRouter.get('/:entryId', requirePermission('journals:read'), async (req, res) => {
  const companyId = req.user!.companyId;
  const entry = await prisma.journalEntry.findFirst({
    where: { entryId: req.params.entryId as string, companyId },
    include: entryInclude,
  });
  if (!entry) throw notFound('Journal entry');
  const links = await reversalLinks(companyId, [entry.entryId]);
  res.status(200).json(serializeEntry(entry, links.get(entry.entryId) ?? null));
});

/**
 * POST /journals — creates a DRAFT entry with at least two lines. The
 * double-entry balance is enforced at post time (and by a DB trigger).
 */
journalRouter.post('/', requirePermission('journals:write'), async (req, res) => {
  const input = createJournalSchema.parse(req.body);
  const companyId = req.user!.companyId;
  const userId = req.user!.userId;

  const entry = await prisma.$transaction(async (tx) => {
    await assertAccountsUsable(tx, companyId, input.lines);
    const nextNumber = await nextEntryNumber(tx, companyId);
    return tx.journalEntry.create({
      data: {
        companyId,
        entryNumber: nextNumber,
        entryDate: new Date(`${input.entryDate}T00:00:00.000Z`),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        status: 'DRAFT',
        createdBy: userId,
        lines: {
          create: input.lines.map((line) => ({
            accountId: line.accountId,
            entryType: line.entryType,
            amount: line.amount,
            description: line.description ?? null,
          })),
        },
      },
      include: entryInclude,
    });
  });
  res.status(201).json(serializeEntry(entry));
});

/** PATCH /journals/:entryId — draft entries only (posted ones are immutable). */
journalRouter.patch('/:entryId', requirePermission('journals:write'), async (req, res) => {
  const input = updateJournalSchema.parse(req.body);
  const entryId = req.params.entryId as string;
  const companyId = req.user!.companyId;

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findFirst({
      where: { entryId, companyId },
      select: { status: true },
    });
    if (!existing) throw notFound('Journal entry');
    if (existing.status !== 'DRAFT') {
      throw new ApiError(409, 'ENTRY_IMMUTABLE', `A ${existing.status} entry cannot be edited`);
    }
    if (input.lines) {
      await assertAccountsUsable(tx, companyId, input.lines);
      await tx.journalEntryLine.deleteMany({ where: { entryId } });
      await tx.journalEntryLine.createMany({
        data: input.lines.map((line) => ({
          entryId,
          accountId: line.accountId,
          entryType: line.entryType,
          amount: line.amount,
          description: line.description ?? null,
        })),
      });
    }
    return tx.journalEntry.update({
      where: { entryId },
      data: {
        ...(input.entryDate !== undefined ? { entryDate: new Date(`${input.entryDate}T00:00:00.000Z`) } : {}),
        ...(input.referenceType !== undefined ? { referenceType: input.referenceType } : {}),
        ...(input.referenceId !== undefined ? { referenceId: input.referenceId } : {}),
      },
      include: entryInclude,
    });
  });
  res.status(200).json(serializeEntry(result));
});

/** POST /journals/:entryId/post — DRAFT → POSTED, enforcing the balance. */
journalRouter.post('/:entryId/post', requirePermission('journals:post'), async (req, res) => {
  const entryId = req.params.entryId as string;
  const companyId = req.user!.companyId;

  const entry = await prisma.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findFirst({
      where: { entryId, companyId },
      include: { lines: true },
    });
    if (!existing) throw notFound('Journal entry');
    if (existing.status !== 'DRAFT') {
      throw new ApiError(422, 'ENTRY_NOT_POSTABLE', 'Only draft entries can be posted');
    }
    await assertAccountsUsable(tx, companyId, existing.lines);
    const balance = sumMoney(
      existing.lines.map((l) => signedAmount(l.entryType, l.amount)),
    );
    if (!balance.isZero()) {
      throw new ApiError(
        422,
        'JOURNAL_UNBALANCED',
        `Debits minus credits must be 0 (is ${moneyToNumber(balance)})`,
      );
    }
    return tx.journalEntry.update({
      where: { entryId },
      data: { status: 'POSTED', postedAt: new Date() },
      include: entryInclude,
    });
  });
  res.status(200).json(serializeEntry(entry));
});

/**
 * POST /journals/:entryId/void — drafts are voided in place; a POSTED entry is
 * never rewritten. Instead a mirror-image REVERSAL entry is posted today and
 * both stay in the ledger, so prior-period balances remain reproducible.
 */
journalRouter.post('/:entryId/void', requirePermission('journals:post'), async (req, res) => {
  const entryId = req.params.entryId as string;
  const companyId = req.user!.companyId;
  const userId = req.user!.userId;

  const entry = await prisma.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findFirst({
      where: { entryId, companyId },
      include: { lines: true },
    });
    if (!existing) throw notFound('Journal entry');
    if (existing.status === 'VOIDED') {
      throw new ApiError(409, 'ENTRY_ALREADY_VOID', 'Entry is already voided');
    }

    if (existing.status === 'DRAFT') {
      const voided = await tx.journalEntry.update({
        where: { entryId },
        data: { status: 'VOIDED' },
        include: entryInclude,
      });
      return serializeEntry(voided);
    }

    const alreadyReversed = await tx.journalEntry.findFirst({
      where: { companyId, referenceType: REVERSAL_REFERENCE_TYPE, referenceId: entryId },
      select: { entryId: true },
    });
    if (alreadyReversed) {
      throw new ApiError(409, 'ENTRY_ALREADY_VOID', 'Entry has already been reversed');
    }

    // Create DRAFT first: the line-immutability trigger rejects new lines on a
    // POSTED entry. Flipping it POSTED then runs the balance guard.
    const reversal = await tx.journalEntry.create({
      data: {
        companyId,
        entryNumber: await nextEntryNumber(tx, companyId),
        entryDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        referenceType: REVERSAL_REFERENCE_TYPE,
        referenceId: entryId,
        status: 'DRAFT',
        createdBy: userId,
        lines: {
          create: existing.lines.map((line) => ({
            accountId: line.accountId,
            entryType: line.entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT',
            amount: line.amount,
            description: line.description,
          })),
        },
      },
      select: { entryId: true },
    });
    await tx.journalEntry.update({
      where: { entryId: reversal.entryId },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    const original = await tx.journalEntry.findUniqueOrThrow({
      where: { entryId },
      include: entryInclude,
    });
    return serializeEntry(original, reversal.entryId);
  });
  res.status(200).json(entry);
});
