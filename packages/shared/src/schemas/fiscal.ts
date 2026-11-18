import { z } from 'zod';
import {
  FISCAL_PERIOD_STATUSES,
  FISCAL_YEAR_STATUSES,
  type FiscalPeriodStatus,
  type FiscalYearStatus,
} from '../constants';
import { isoDateSchema } from './common';

export const createFiscalYearSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });
export type CreateFiscalYearInput = z.infer<typeof createFiscalYearSchema>;

export const createFiscalPeriodSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    periodNumber: z.number().int().positive(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });
export type CreateFiscalPeriodInput = z.infer<typeof createFiscalPeriodSchema>;

export const reopenPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ReopenPeriodInput = z.infer<typeof reopenPeriodSchema>;

export interface FiscalPeriod {
  periodId: string;
  fiscalYearId: string;
  companyId: string;
  name: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: FiscalPeriodStatus;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
}

export interface FiscalYear {
  fiscalYearId: string;
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  periods: FiscalPeriod[];
}

export interface FiscalEvent {
  eventId: string;
  companyId: string;
  fiscalYearId: string | null;
  periodId: string | null;
  action: 'CLOSE_PERIOD' | 'REOPEN_PERIOD' | 'CLOSE_YEAR' | 'YEAR_END_CLOSE';
  reason: string | null;
  actorUserId: string;
  actorName: string;
  createdAt: string;
}

export const fiscalYearStatusSchema = z.enum(FISCAL_YEAR_STATUSES);
export const fiscalPeriodStatusSchema = z.enum(FISCAL_PERIOD_STATUSES);
