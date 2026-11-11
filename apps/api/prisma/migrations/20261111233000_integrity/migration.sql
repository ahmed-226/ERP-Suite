-- Integrity that the Prisma schema language cannot express: CHECK constraints
-- (mirroring dev/docs/erd.md) plus the double-entry balance guard, posted-line
-- immutability and append-only movement ledger triggers.

-- CHECK constraints ----------------------------------------------------------
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_unit_cost_nonnegative" CHECK ("unit_cost" >= 0);
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_on_hand_nonnegative" CHECK ("quantity_on_hand" >= 0);
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_reserved_nonnegative" CHECK ("quantity_reserved" >= 0);

-- Double-entry guard ---------------------------------------------------------
-- Becoming POSTED requires >= 2 lines and sum(debits) - sum(credits) = 0.
CREATE OR REPLACE FUNCTION trg_fn_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  line_count int;
  balance numeric;
BEGIN
  SELECT count(*),
         coalesce(sum(CASE entry_type WHEN 'DEBIT' THEN amount ELSE -amount END), 0)
    INTO line_count, balance
    FROM journal_entry_lines
   WHERE entry_id = NEW.entry_id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: a posted entry needs at least 2 lines (has %)', line_count;
  END IF;
  IF balance <> 0 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debits minus credits must be 0 (is %)', balance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entry_balanced
  BEFORE INSERT OR UPDATE OF status ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'POSTED')
  EXECUTE FUNCTION trg_fn_journal_entry_balanced();

-- Lines of a non-DRAFT entry are immutable (POSTED and VOIDED stay auditable).
CREATE OR REPLACE FUNCTION trg_fn_journal_line_immutable() RETURNS trigger AS $$
DECLARE
  entry_status journal_entries.status%TYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO entry_status FROM journal_entries WHERE entry_id = NEW.entry_id;
  ELSE
    SELECT status INTO entry_status FROM journal_entries WHERE entry_id = OLD.entry_id;
  END IF;

  IF entry_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'JOURNAL_IMMUTABLE: lines of a % entry cannot change', entry_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_journal_line_immutable();

-- Append-only movement ledger ------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_inventory_tx_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'INVENTORY_APPEND_ONLY: inventory_transactions cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_tx_append_only
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_inventory_tx_append_only();
