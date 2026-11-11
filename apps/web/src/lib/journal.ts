import type { EntryType } from '@erp/shared';

/** A journal line as held by the editor form (values may be incomplete). */
export interface DraftLineValues {
  entryType?: EntryType;
  amount?: number;
}

export interface EntryTotals {
  totalDebit: number;
  totalCredit: number;
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

/** Running debit/credit totals used by the editor's live balance indicator. */
export function computeTotals(lines: DraftLineValues[] = []): EntryTotals {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const amount = line.amount ?? 0;
    if (line.entryType === 'CREDIT') totalCredit += amount;
    else totalDebit += amount;
  }
  return { totalDebit: round(totalDebit), totalCredit: round(totalCredit) };
}
