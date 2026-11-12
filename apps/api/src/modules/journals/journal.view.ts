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

/** JE-0001, JE-0002, ... per company, from the current highest suffix. */
export async function nextEntryNumber(
  tx: { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>; $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  companyId: string,
): Promise<string> {
  // Serialize entry-number allocation per company (concurrent receipts and
  // manual entries would otherwise race on max(entry_number)).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('erp-entry-number'), hashtext(${companyId}))`;
  const rows = await tx.$queryRaw`SELECT coalesce(max((substring(entry_number from 'JE-([0-9]+)$'))::bigint), 0) AS max
    FROM journal_entries WHERE company_id::text = ${companyId}`;
  const max = Number((rows[0] as { max: bigint | number } | undefined)?.max ?? 0);
  return `JE-${String(max + 1).padStart(4, '0')}`;
}
