import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Expected a valid calendar date in YYYY-MM-DD format');

export const optionalIsoDateSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  isoDateSchema.optional(),
);

/** Error envelope used by the API and mirrored by the mock data source. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface DateRangeFilter {
  from?: string;
  to?: string;
}
