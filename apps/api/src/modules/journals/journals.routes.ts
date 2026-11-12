import { Router } from 'express';
import {
  createJournalSchema,
  updateJournalSchema,
  type JournalFilter,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { entryInclude, entryWhere, nextEntryNumber, serializeEntry } from './journal.view';

export const journalRouter = Router();

journalRouter.use(requireAuth);

/** GET /journals?status=&referenceType=&from=&to=&search= */
journalRouter.get('/', requirePermission('journals:read'), async (req, res) => {
  const filter = req.query as JournalFilter;
  const entries = await prisma.journalEntry.findMany({
    where: entryWhere(req.user!.companyId, filter),
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    include: entryInclude,
  });
  res.status(200).json(entries.map(serializeEntry));
});

journalRouter.get('/:entryId', requirePermission('journals:read'), async (req, res) => {
  const entry = await prisma.journalEntry.findFirst({
    where: { entryId: req.params.entryId as string, companyId: req.user!.companyId },
    include: entryInclude,
  });
  if (!entry) throw notFound('Journal entry');
  res.status(200).json(serializeEntry(entry));
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
    const balance = existing.lines.reduce(
      (sum, l) => sum + (l.entryType === 'DEBIT' ? Number(l.amount) : -Number(l.amount)),
      0,
    );
    if (balance !== 0) {
      throw new ApiError(422, 'JOURNAL_UNBALANCED', `Debits minus credits must be 0 (is ${balance})`);
    }
    return tx.journalEntry.update({
      where: { entryId },
      data: { status: 'POSTED', postedAt: new Date() },
      include: entryInclude,
    });
  });
  res.status(200).json(serializeEntry(entry));
});

/** POST /journals/:entryId/void — any non-voided entry can be voided. */
journalRouter.post('/:entryId/void', requirePermission('journals:post'), async (req, res) => {
  const entryId = req.params.entryId as string;
  const existing = await prisma.journalEntry.findFirst({
    where: { entryId, companyId: req.user!.companyId },
    select: { status: true },
  });
  if (!existing) throw notFound('Journal entry');
  if (existing.status === 'VOIDED') {
    throw new ApiError(409, 'ENTRY_ALREADY_VOID', 'Entry is already voided');
  }
  const entry = await prisma.journalEntry.update({
    where: { entryId },
    data: { status: 'VOIDED' },
    include: entryInclude,
  });
  res.status(200).json(serializeEntry(entry));
});
