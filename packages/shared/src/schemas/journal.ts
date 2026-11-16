import { z } from 'zod';
import { ENTRY_TYPES, JOURNAL_STATUSES, type EntryType, type JournalStatus } from '../constants';
import { isoDateSchema, optionalIsoDateSchema } from './common';

export const journalLineInputSchema = z.object({
  accountId: z.string().uuid(),
  entryType: z.enum(ENTRY_TYPES),
  amount: z.number().positive(),
  description: z.string().max(500).nullable().optional(),
});
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const createJournalSchema = z.object({
  entryDate: isoDateSchema,
  referenceType: z.string().max(50).nullable().optional(),
  referenceId: z.string().uuid().nullable().optional(),
  lines: z.array(journalLineInputSchema).min(2, 'A journal entry needs at least two lines'),
});
export type CreateJournalInput = z.infer<typeof createJournalSchema>;

export const updateJournalSchema = createJournalSchema.partial();
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;

export interface JournalEntryLine {
  lineId: string;
  entryId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  entryType: EntryType;
  amount: number;
  description: string | null;
}

export interface JournalEntry {
  entryId: string;
  companyId: string;
  entryNumber: string;
  entryDate: string;
  referenceType: string | null;
  referenceId: string | null;
  status: JournalStatus;
  postedAt: string | null;
  /** Set when a POSTED entry has been reversed; points at the reversing entry. */
  reversedByEntryId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  lines: JournalEntryLine[];
  totalDebit: number;
  totalCredit: number;
}

export const journalFilterSchema = z.object({
  status: z.preprocess((value) => (value === '' ? undefined : value), z.enum(JOURNAL_STATUSES).optional()),
  referenceType: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() || undefined : value),
    z.string().optional(),
  ),
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
  search: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() || undefined : value),
    z.string().optional(),
  ),
});

export type JournalFilter = z.infer<typeof journalFilterSchema>;
