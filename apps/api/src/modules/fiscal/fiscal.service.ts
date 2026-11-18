import { Decimal, money, moneyToNumber, sumMoney, SYSTEM_ACCOUNT_CODES } from '@erp/shared';
import { ApiError } from '../../lib/errors';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/db';
import { nextEntryNumber } from '../journals/journal.view';

type Db = typeof prisma | Prisma.TransactionClient;

export function toDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function assertPeriodOpen(
  db: Db,
  companyId: string,
  date: string | Date,
): Promise<void> {
  const d = typeof date === 'string' ? toDateOnly(date) : date;
  const closed = await db.fiscalPeriod.findFirst({
    where: {
      companyId,
      status: 'CLOSED',
      startDate: { lte: d },
      endDate: { gte: d },
    },
    select: { periodId: true, name: true, startDate: true, endDate: true },
  });
  if (closed) {
    throw new ApiError(
      422,
      'PERIOD_LOCKED',
      `Date ${formatDateOnly(d)} falls in closed period ${closed.name}`,
      {
        periodId: closed.periodId,
        startDate: formatDateOnly(closed.startDate),
        endDate: formatDateOnly(closed.endDate),
      },
    );
  }
}

export function assertRangesWithinYear(
  year: { startDate: Date; endDate: Date },
  startDate: string,
  endDate: string,
): void {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  if (start < year.startDate || end > year.endDate) {
    throw new ApiError(422, 'PERIOD_OUT_OF_YEAR', 'Period must fall within its fiscal year');
  }
}
