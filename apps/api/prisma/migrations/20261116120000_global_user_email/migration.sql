-- Login looks a user up by email alone. A per-company email uniqueness rule
-- lets two tenants share an address, and `findFirst` would then authenticate
-- whichever row happened to come back first. Make the address globally unique,
-- case-insensitively, so it can never resolve to the wrong tenant.

-- Fail loudly instead of silently picking a winner if a database already has
-- duplicate addresses (exact or case variants).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" GROUP BY lower("email") HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'users.email must be globally unique: resolve duplicate addresses before migrating';
  END IF;
END $$;

UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");

DROP INDEX "users_company_id_email_key";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Keep the unique index case-insensitive: writers cannot store an address in a
-- different case and sneak a second account past the constraint.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
