import type { JournalEntry, JournalEntryLine, JournalFilter } from '@erp/shared';
import type { Prisma } from '../../generated/prisma/client';

type FullEntry = Prisma.JournalEntryGetPayload<{
  include: {
    createdByUser: { select: { fullName: true } };
    lines: { include: { account: { select: { accountCode: true; accountName: true } } } };
  };
}>;

export function serializeEntry(entry: FullEntry): JournalEntry {
  const lines: JournalEntryLine[] = entry.lines.map((line) => ({
    lineId: line.lineId,
    entryId: line.entryId,
    accountId: line.accountId,
    accountCode: line.account.accountCode,
    accountName: line.account.accountName,
    entryType: line.entryType,
    amount: Number(line.amount),
    description: line.description,
  }));
  const totalDebit = lines
    .filter((l) => l.entryType === 'DEBIT')
    .reduce((sum, l) => sum + l.amount, 0);
  const totalCredit = lines
    .filter((l) => l.entryType === 'CREDIT')
    .reduce((sum, l) => sum + l.amount, 0);
  return {
    entryId: entry.entryId,
    companyId: entry.companyId,
    entryNumber: entry.entryNumber,
    entryDate: entry.entryDate.toISOString().slice(0, 10),
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    status: entry.status,
    postedAt: entry.postedAt?.toISOString() ?? null,
    createdBy: entry.createdBy,
    createdByName: entry.createdByUser.fullName,
    createdAt: entry.createdAt.toISOString(),
    lines,
    totalDebit,
    totalCredit,
  };
}

export const entryInclude = {
  createdByUser: { select: { fullName: true } },
  lines: { include: { account: { select: { accountCode: true, accountName: true } } } },
} as const;

/** Map the shared JournalFilter onto a Prisma where-clause. */
export function entryWhere(companyId: string, filter: JournalFilter) {
  return {
    companyId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.referenceType ? { referenceType: filter.referenceType } : {}),
    ...(filter.from || filter.to
      ? { entryDate: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}) } }
      : {}),
    ...(filter.search
      ? {
          OR: [
            { entryNumber: { contains: filter.search, mode: 'insensitive' as const } },
            { referenceType: { contains: filter.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}
