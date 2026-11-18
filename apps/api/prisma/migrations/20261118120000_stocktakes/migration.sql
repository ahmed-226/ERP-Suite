-- Stocktake / cycle count (P1.5): auditable count sheets per warehouse.
-- Applying a count creates adjustment movements and GL postings; it never
-- edits the ledger/stock directly outside that normal path.

CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'APPLIED', 'CANCELLED');

CREATE TABLE "stocktakes" (
  "stocktake_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "applied_by" UUID,
  "applied_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("stocktake_id")
);

CREATE TABLE "stocktake_lines" (
  "line_id" UUID NOT NULL,
  "stocktake_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "system_quantity" INTEGER NOT NULL,
  "counted_quantity" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,

  CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("line_id"),
  CONSTRAINT "stocktake_lines_variance_check" CHECK ("variance" = "counted_quantity" - "system_quantity")
);

CREATE INDEX "stocktakes_company_id_warehouse_id_created_at_idx"
  ON "stocktakes"("company_id", "warehouse_id", "created_at" DESC);

CREATE UNIQUE INDEX "stocktake_lines_stocktake_id_product_id_key"
  ON "stocktake_lines"("stocktake_id", "product_id");

CREATE INDEX "stocktake_lines_stocktake_id_idx"
  ON "stocktake_lines"("stocktake_id");

ALTER TABLE "stocktakes"
  ADD CONSTRAINT "stocktakes_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktakes"
  ADD CONSTRAINT "stocktakes_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktakes"
  ADD CONSTRAINT "stocktakes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktakes"
  ADD CONSTRAINT "stocktakes_applied_by_fkey"
  FOREIGN KEY ("applied_by") REFERENCES "users"("user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktake_lines"
  ADD CONSTRAINT "stocktake_lines_stocktake_id_fkey"
  FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("stocktake_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stocktake_lines"
  ADD CONSTRAINT "stocktake_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("product_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
