-- Fiscal calendar (years, periods) with close/reopen audit and year-end close support.

CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "fiscal_years" (
  "fiscal_year_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "name" VARCHAR(50) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
  "closed_at" TIMESTAMPTZ(6),
  "closed_by" UUID,
  "closing_entry_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("fiscal_year_id"),
  CONSTRAINT "fiscal_years_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_years_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_years_closing_entry_id_fkey" FOREIGN KEY ("closing_entry_id") REFERENCES "journal_entries"("entry_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_years_date_range_ck" CHECK ("start_date" <= "end_date")
);

CREATE UNIQUE INDEX "fiscal_years_company_id_name_key" ON "fiscal_years"("company_id", "name");
CREATE INDEX "fiscal_years_company_id_start_date_idx" ON "fiscal_years"("company_id", "start_date");

CREATE TABLE "fiscal_periods" (
  "period_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fiscal_year_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" VARCHAR(50) NOT NULL,
  "period_number" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closed_at" TIMESTAMPTZ(6),
  "closed_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("period_id"),
  CONSTRAINT "fiscal_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("fiscal_year_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscal_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_periods_date_range_ck" CHECK ("start_date" <= "end_date"),
  CONSTRAINT "fiscal_periods_period_number_ck" CHECK ("period_number" > 0)
);

CREATE UNIQUE INDEX "fiscal_periods_fiscal_year_id_period_number_key" ON "fiscal_periods"("fiscal_year_id", "period_number");
CREATE INDEX "fiscal_periods_company_id_start_date_end_date_idx" ON "fiscal_periods"("company_id", "start_date", "end_date");

CREATE TABLE "fiscal_events" (
  "event_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "fiscal_year_id" UUID,
  "period_id" UUID,
  "action" VARCHAR(30) NOT NULL,
  "reason" TEXT,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fiscal_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "fiscal_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_events_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("fiscal_year_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscal_events_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "fiscal_periods"("period_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fiscal_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_events_action_ck" CHECK ("action" IN ('CLOSE_PERIOD', 'REOPEN_PERIOD', 'CLOSE_YEAR', 'YEAR_END_CLOSE'))
);

CREATE INDEX "fiscal_events_company_id_created_at_idx" ON "fiscal_events"("company_id", "created_at" DESC);

-- Seed the Retained Earnings system account (3100) for companies that have the
-- standard equity parent (3000). Idempotent for existing seeded/demo databases.
INSERT INTO "chart_of_accounts" (
  "account_id", "company_id", "account_code", "account_name", "account_type", "parent_account_id", "is_active"
)
SELECT
  '44444444-0000-0000-0000-00000000000a'::uuid,
  c."company_id",
  '3100',
  'Retained Earnings',
  'EQUITY'::"AccountType",
  p."account_id",
  true
FROM "chart_of_accounts" p
JOIN "companies" c ON c."company_id" = p."company_id"
WHERE p."account_code" = '3000'
ON CONFLICT ("company_id", "account_code") DO NOTHING;
