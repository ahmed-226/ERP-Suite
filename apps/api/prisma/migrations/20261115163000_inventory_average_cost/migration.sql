-- Company-wide weighted-average cost per product, used for issue/adjustment
-- valuation. Backfill from the cost of inbound movements (receipts and positive
-- adjustments); outbound movements do not set a cost basis.
ALTER TABLE "products" ADD COLUMN "average_cost" DECIMAL(15, 4) NOT NULL DEFAULT 0;

UPDATE "products" AS p
SET "average_cost" = COALESCE(
  (
    SELECT SUM(t."quantity" * t."unit_cost") / NULLIF(SUM(t."quantity"), 0)
    FROM "inventory_transactions" AS t
    WHERE t."product_id" = p."product_id"
      AND t."quantity" > 0
      AND t."movement_type" IN ('GOODS_RECEIPT', 'ADJUSTMENT')
  ),
  0
);
