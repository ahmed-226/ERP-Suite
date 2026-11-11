import { z } from 'zod';
import { ENTRY_TYPES, type EntryType, type JournalStatus } from '../constants';
import { isoDateSchema } from './common';

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
  createdBy: string;
  createdByName: string;
  createdAt: string;
  lines: JournalEntryLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface JournalFilter {
  status?: JournalStatus;
  referenceType?: string;
  from?: string;
  to?: string;
  search?: string;
}
