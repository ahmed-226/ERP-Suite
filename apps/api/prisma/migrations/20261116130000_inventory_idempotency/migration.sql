-- Store original responses for retried inventory writes (P0.11). The key is
-- scoped per company so a replay returns the same result without reapplying
-- stock or posting a duplicate GL entry.
CREATE TABLE "inventory_idempotency_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "operation" VARCHAR(50) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_idempotency_keys_company_id_key_key"
  ON "inventory_idempotency_keys"("company_id", "key");

CREATE INDEX "inventory_idempotency_keys_company_id_created_at_idx"
  ON "inventory_idempotency_keys"("company_id", "created_at" DESC);

ALTER TABLE "inventory_idempotency_keys"
  ADD CONSTRAINT "inventory_idempotency_keys_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
