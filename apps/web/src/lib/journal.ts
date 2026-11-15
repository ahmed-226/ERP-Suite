import { moneyToNumber, sumMoney, type EntryType } from '@erp/shared';

/** A journal line as held by the editor form (values may be incomplete). */
export interface DraftLineValues {
  entryType?: EntryType;
  amount?: number;
}

export interface EntryTotals {
  totalDebit: number;
  totalCredit: number;
}

/** Running debit/credit totals used by the editor's live balance indicator. */
export function computeTotals(lines: DraftLineValues[] = []): EntryTotals {
  return {
    totalDebit: moneyToNumber(
      sumMoney(
        lines.filter((line) => line.entryType !== 'CREDIT').map((line) => line.amount ?? 0),
      ),
    ),
    totalCredit: moneyToNumber(
      sumMoney(
        lines.filter((line) => line.entryType === 'CREDIT').map((line) => line.amount ?? 0),
      ),
    ),
  };
}
