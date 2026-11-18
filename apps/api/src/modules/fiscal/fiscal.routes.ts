import { Router } from 'express';
import {
  createFiscalPeriodSchema,
  createFiscalYearSchema,
  Decimal,
  money,
  moneyToNumber,
  reopenPeriodSchema,
  sumMoney,
  SYSTEM_ACCOUNT_CODES,
} from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError, notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { nextEntryNumber } from '../journals/journal.view';
import { assertPeriodOpen, assertRangesWithinYear, formatDateOnly, toDateOnly } from './fiscal.service';

export const fiscalRouter = Router();

fiscalRouter.use(requireAuth);

const yearInclude = {
  closedByUser: { select: { fullName: true } },
  periods: {
    include: { closedByUser: { select: { fullName: true } } },
    orderBy: [{ periodNumber: 'asc' as const }],
  },
} as const;

function serializePeriod(p: {
  periodId: string;
  fiscalYearId: string;
  companyId: string;
  name: string;
  periodNumber: number;
  startDate: Date;
  endDate: Date;
  status: 'OPEN' | 'CLOSED';
  closedAt: Date | null;
  closedBy: string | null;
  closedByUser: { fullName: string } | null;
}) {
  return {
    periodId: p.periodId,
    fiscalYearId: p.fiscalYearId,
    companyId: p.companyId,
    name: p.name,
    periodNumber: p.periodNumber,
    startDate: formatDateOnly(p.startDate),
    endDate: formatDateOnly(p.endDate),
    status: p.status,
    closedAt: p.closedAt?.toISOString() ?? null,
    closedBy: p.closedBy,
    closedByName: p.closedByUser?.fullName ?? null,
  };
}

function serializeYear(y: {
  fiscalYearId: string;
  companyId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'OPEN' | 'CLOSED';
  closedAt: Date | null;
  closedBy: string | null;
  closedByUser: { fullName: string } | null;
  periods: Array<Parameters<typeof serializePeriod>[0]>;
}) {
  return {
    fiscalYearId: y.fiscalYearId,
    companyId: y.companyId,
    name: y.name,
    startDate: formatDateOnly(y.startDate),
    endDate: formatDateOnly(y.endDate),
    status: y.status,
    closedAt: y.closedAt?.toISOString() ?? null,
    closedBy: y.closedBy,
    closedByName: y.closedByUser?.fullName ?? null,
    periods: y.periods.map(serializePeriod),
  };
}

/** GET /fiscal/years — fiscal calendar with periods. */
fiscalRouter.get('/years', requirePermission('reports:read'), async (req, res) => {
  const years = await prisma.fiscalYear.findMany({
    where: { companyId: req.user!.companyId },
    include: yearInclude,
    orderBy: { startDate: 'desc' },
  });
  res.status(200).json(years.map(serializeYear));
});

/** POST /fiscal/years */
fiscalRouter.post('/years', requirePermission('accounts:write'), async (req, res) => {
  const input = createFiscalYearSchema.parse(req.body);
  const companyId = req.user!.companyId;

  const overlap = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      startDate: { lte: toDateOnly(input.endDate) },
      endDate: { gte: toDateOnly(input.startDate) },
    },
    select: { fiscalYearId: true },
  });
  if (overlap) {
    throw new ApiError(409, 'FISCAL_YEAR_OVERLAP', 'Fiscal year overlaps an existing year');
  }

  const year = await prisma.fiscalYear.create({
    data: {
      companyId,
      name: input.name,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
    },
    include: yearInclude,
  });
  res.status(201).json(serializeYear(year));
});

/** POST /fiscal/years/:fiscalYearId/periods */
fiscalRouter.post(
  '/years/:fiscalYearId/periods',
  requirePermission('accounts:write'),
  async (req, res) => {
    const input = createFiscalPeriodSchema.parse(req.body);
    const companyId = req.user!.companyId;
    const fiscalYearId = req.params.fiscalYearId as string;

    const year = await prisma.fiscalYear.findFirst({ where: { fiscalYearId, companyId } });
    if (!year) throw notFound('Fiscal year');
    assertRangesWithinYear(year, input.startDate, input.endDate);

    const overlap = await prisma.fiscalPeriod.findFirst({
      where: {
        companyId,
        fiscalYearId,
        startDate: { lte: toDateOnly(input.endDate) },
        endDate: { gte: toDateOnly(input.startDate) },
      },
      select: { periodId: true },
    });
    if (overlap) {
      throw new ApiError(409, 'FISCAL_PERIOD_OVERLAP', 'Period overlaps an existing period');
    }

    const period = await prisma.fiscalPeriod.create({
      data: {
        companyId,
        fiscalYearId,
        name: input.name,
        periodNumber: input.periodNumber,
        startDate: toDateOnly(input.startDate),
        endDate: toDateOnly(input.endDate),
      },
      include: { closedByUser: { select: { fullName: true } } },
    });
    res.status(201).json(serializePeriod(period));
  },
);

/** POST /fiscal/periods/:periodId/close */
fiscalRouter.post(
  '/periods/:periodId/close',
  requirePermission('accounts:write'),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.userId;
    const periodId = req.params.periodId as string;

    const period = await prisma.$transaction(async (tx) => {
      const existing = await tx.fiscalPeriod.findFirst({ where: { periodId, companyId } });
      if (!existing) throw notFound('Fiscal period');
      if (existing.status === 'CLOSED') {
        throw new ApiError(409, 'PERIOD_ALREADY_CLOSED', 'Fiscal period is already closed');
      }
      const updated = await tx.fiscalPeriod.update({
        where: { periodId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: userId },
        include: { closedByUser: { select: { fullName: true } } },
      });
      await tx.fiscalEvent.create({
        data: {
          companyId,
          fiscalYearId: existing.fiscalYearId,
          periodId,
          action: 'CLOSE_PERIOD',
          actorUserId: userId,
        },
      });
      return updated;
    });
    res.status(200).json(serializePeriod(period));
  },
);

/** POST /fiscal/periods/:periodId/reopen — reopening is audited. */
fiscalRouter.post(
  '/periods/:periodId/reopen',
  requirePermission('accounts:write'),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.userId;
    const periodId = req.params.periodId as string;
    const input = reopenPeriodSchema.parse(req.body ?? {});

    const period = await prisma.$transaction(async (tx) => {
      const existing = await tx.fiscalPeriod.findFirst({
        where: { periodId, companyId },
        include: { fiscalYear: { select: { status: true, name: true } } },
      });
      if (!existing) throw notFound('Fiscal period');
      if (existing.status === 'OPEN') {
        throw new ApiError(409, 'PERIOD_ALREADY_OPEN', 'Fiscal period is already open');
      }
      if (existing.fiscalYear.status === 'CLOSED') {
        throw new ApiError(409, 'FISCAL_YEAR_CLOSED', 'Cannot reopen a period in a closed fiscal year');
      }
      const updated = await tx.fiscalPeriod.update({
        where: { periodId },
        data: { status: 'OPEN', closedAt: null, closedBy: null },
        include: { closedByUser: { select: { fullName: true } } },
      });
      await tx.fiscalEvent.create({
        data: {
          companyId,
          fiscalYearId: existing.fiscalYearId,
          periodId,
          action: 'REOPEN_PERIOD',
          reason: input.reason ?? null,
          actorUserId: userId,
        },
      });
      return updated;
    });
    res.status(200).json(serializePeriod(period));
  },
);

/** GET /fiscal/events — recent period close/reopen/year-end actions. */
fiscalRouter.get('/events', requirePermission('reports:read'), async (req, res) => {
  const events = await prisma.fiscalEvent.findMany({
    where: { companyId: req.user!.companyId },
    include: { actor: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.status(200).json(
    events.map((e) => ({
      eventId: e.eventId,
      companyId: e.companyId,
      fiscalYearId: e.fiscalYearId,
      periodId: e.periodId,
      action: e.action,
      reason: e.reason,
      actorUserId: e.actorUserId,
      actorName: e.actor.fullName,
      createdAt: e.createdAt.toISOString(),
    })),
  );
});

/** POST /fiscal/years/:fiscalYearId/year-end-close — transfer revenue/expense to retained earnings. */
fiscalRouter.post(
  '/years/:fiscalYearId/year-end-close',
  requirePermission('accounts:write'),
  async (req, res) => {
    const companyId = req.user!.companyId;
    const userId = req.user!.userId;
    const fiscalYearId = req.params.fiscalYearId as string;

    const result = await prisma.$transaction(async (tx) => {
      const year = await tx.fiscalYear.findFirst({
        where: { fiscalYearId, companyId },
        include: { periods: true },
      });
      if (!year) throw notFound('Fiscal year');
      if (year.status === 'CLOSED' || year.closingEntryId) {
        throw new ApiError(409, 'FISCAL_YEAR_CLOSED', 'Fiscal year is already closed');
      }

      // Year-end close posts its closing entry at the fiscal year end. Require all
      // periods in the year to be closed first; the controlled closing entry is the
      // final posting into that closed calendar.
      const openPeriods = year.periods.filter((p) => p.status !== 'CLOSED');
      if (openPeriods.length > 0) {
        throw new ApiError(422, 'PERIODS_NOT_CLOSED', 'Close all periods in the fiscal year before year-end close', {
          openPeriodIds: openPeriods.map((p) => p.periodId),
        });
      }

      const retained = await tx.chartOfAccount.findFirst({
        where: { companyId, accountCode: SYSTEM_ACCOUNT_CODES.retainedEarnings },
        select: { accountId: true, isActive: true },
      });
      if (!retained) {
        throw new ApiError(422, 'RETAINED_EARNINGS_MISSING', 'Retained earnings account (3100) is missing');
      }

      const lines = await tx.journalEntryLine.findMany({
        where: {
          entry: {
            companyId,
            status: 'POSTED',
            entryDate: { gte: year.startDate, lte: year.endDate },
            referenceType: { not: 'YEAR_END_CLOSE' },
          },
          account: { accountType: { in: ['REVENUE', 'EXPENSE'] } },
        },
        select: {
          accountId: true,
          entryType: true,
          amount: true,
          account: { select: { accountType: true } },
        },
      });

      const byAccount = new Map<string, { accountType: 'REVENUE' | 'EXPENSE'; balance: Decimal }>();
      for (const line of lines) {
        const row = byAccount.get(line.accountId) ?? {
          accountType: line.account.accountType as 'REVENUE' | 'EXPENSE',
          balance: new Decimal(0),
        };
        const amount = line.amount.toString();
        // Revenue normal credit; expense normal debit. balance is the normal-side amount.
        if (row.accountType === 'REVENUE') {
          row.balance = line.entryType === 'CREDIT' ? row.balance.plus(amount) : row.balance.minus(amount);
        } else {
          row.balance = line.entryType === 'DEBIT' ? row.balance.plus(amount) : row.balance.minus(amount);
        }
        byAccount.set(line.accountId, row);
      }

      const closingLines: Array<{ accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: Decimal }> = [];
      let netIncome = new Decimal(0);
      for (const [accountId, row] of byAccount) {
        if (row.balance.isZero()) continue;
        if (row.accountType === 'REVENUE') {
          // Debit revenue to zero it, credit effect flows to retained earnings.
          closingLines.push({ accountId, entryType: 'DEBIT', amount: row.balance });
          netIncome = netIncome.plus(row.balance);
        } else {
          // Credit expense to zero it.
          closingLines.push({ accountId, entryType: 'CREDIT', amount: row.balance });
          netIncome = netIncome.minus(row.balance);
        }
      }

      let closingEntryId: string | null = null;
      if (!netIncome.isZero() || closingLines.length > 0) {
        if (netIncome.isZero()) {
          throw new ApiError(422, 'INVALID_CLOSE', 'Closing balances do not produce a net result');
        }
        // Net profit (credit balance) increases retained earnings; net loss decreases it.
        if (netIncome.greaterThan(0)) {
          closingLines.push({ accountId: retained.accountId, entryType: 'CREDIT', amount: netIncome });
        } else {
          closingLines.push({ accountId: retained.accountId, entryType: 'DEBIT', amount: netIncome.abs() });
        }
        const entryNumber = await nextEntryNumber(tx, companyId);
        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            entryNumber,
            entryDate: year.endDate,
            referenceType: 'YEAR_END_CLOSE',
            referenceId: year.fiscalYearId,
            status: 'DRAFT',
            createdBy: userId,
            lines: {
              create: closingLines.map((line) => ({
                accountId: line.accountId,
                entryType: line.entryType,
                amount: line.amount,
                description: 'Year-end close',
              })),
            },
          },
          select: { entryId: true },
        });
        await tx.journalEntry.update({
          where: { entryId: entry.entryId },
          data: { status: 'POSTED', postedAt: new Date() },
        });
        closingEntryId = entry.entryId;
      }

      const updated = await tx.fiscalYear.update({
        where: { fiscalYearId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: userId, closingEntryId },
        include: yearInclude,
      });
      await tx.fiscalEvent.create({
        data: {
          companyId,
          fiscalYearId,
          action: 'YEAR_END_CLOSE',
          actorUserId: userId,
          reason: closingEntryId ? `Closing entry ${closingEntryId}` : 'No revenue/expense balances to close',
        },
      });
      return updated;
    });

    res.status(200).json(serializeYear(result));
  },
);
