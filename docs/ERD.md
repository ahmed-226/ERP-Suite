# Entity-Relationship Diagram (Stage A)

> Mirrors exactly what is implemented in Phase A of `apps/web`: the in-memory
> mock store (`apps/web/src/data/mock/store.ts`) and the frozen DTO contracts
> (`packages/shared/src/schemas/*`). Stage B maps this model 1:1 onto Postgres
> tables; the DB-level source of truth remains `dev/docs/erd.md`.

## Diagram

```mermaid
erDiagram
    COMPANY ||--o{ USER : "scopes"
    COMPANY ||--o{ ROLE : "scopes"
    COMPANY ||--o{ ACCOUNT : "scopes"
    COMPANY ||--o{ PRODUCT : "scopes"
    COMPANY ||--o{ WAREHOUSE : "scopes"
    COMPANY ||--o{ JOURNAL_ENTRY : "scopes"
    COMPANY ||--o{ STOCKTAKE : "scopes"

    USER }o--|| ROLE : "assigned role"
    USER ||--o{ JOURNAL_ENTRY : "created by"
    USER ||--o{ INVENTORY_TRANSACTION : "recorded by"
    USER ||--o{ STOCKTAKE : "creates"
    USER |o--o{ STOCKTAKE : "applies"

    ACCOUNT |o--o{ ACCOUNT : "parent of"

    JOURNAL_ENTRY ||--|{ JOURNAL_ENTRY_LINE : "contains"
    JOURNAL_ENTRY_LINE }o--|| ACCOUNT : "posts to"
    JOURNAL_ENTRY }o--o| INVENTORY_TRANSACTION : "auto-generated for"

    PRODUCT ||--o{ INVENTORY_STOCK : "stocked as"
    WAREHOUSE ||--o{ INVENTORY_STOCK : "holds"
    PRODUCT ||--o{ INVENTORY_TRANSACTION : "moved in"
    WAREHOUSE ||--o{ INVENTORY_TRANSACTION : "location of"

    WAREHOUSE ||--o{ STOCKTAKE : "counted in"
    STOCKTAKE ||--|{ STOCKTAKE_LINE : "contains"
    PRODUCT ||--o{ STOCKTAKE_LINE : "counted as"

    COMPANY {
        string companyId PK
        string name
    }
    ROLE {
        string roleId PK
        string companyId FK
        string code
        string name
        string permissions "flattened permission list"
    }
    USER {
        string userId PK
        string companyId FK
        string email "globally unique, lowercase"
        string fullName
        boolean isActive
    }
    ACCOUNT {
        string accountId PK
        string companyId FK
        string accountCode UK
        string accountName
        string accountType "ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE"
        string parentAccountId FK "self-reference"
        boolean isActive
    }
    PRODUCT {
        string productId PK
        string companyId FK
        string sku UK
        string name
        string unitOfMeasure
        int reorderThreshold
        decimal averageCost "company-wide weighted average"
        boolean isActive
    }
    WAREHOUSE {
        string warehouseId PK
        string companyId FK
        string code UK
        string name
        string locationAddress
        boolean isActive
    }
    INVENTORY_STOCK {
        string stockId PK
        string productId FK
        string warehouseId FK
        int quantityOnHand "never negative"
        int quantityReserved
    }
    INVENTORY_TRANSACTION {
        string transactionId PK
        string productId FK
        string warehouseId FK
        string movementType "GOODS_RECEIPT | SALES_ISSUE | TRANSFER_IN | TRANSFER_OUT | ADJUSTMENT"
        int quantity "positive in, negative out"
        decimal unitCost
        string referenceId FK "optional external reference"
        string createdBy FK
    }
    JOURNAL_ENTRY {
        string entryId PK
        string companyId FK
        string entryNumber UK "JE-0001 style counter"
        date entryDate
        string status "DRAFT | POSTED | VOIDED"
        string referenceType "MANUAL | INVENTORY_RECEIPT | SALES_ISSUE | ADJUSTMENT | REVERSAL"
        string referenceId FK "movement id, or reversed entry id for REVERSAL"
        string createdBy FK
        string postedAt
    }
    JOURNAL_ENTRY_LINE {
        string lineId PK
        string entryId FK
        string accountId FK
        string entryType "DEBIT | CREDIT"
        decimal amount "always positive"
        string description
    }
    STOCKTAKE {
        string stocktakeId PK
        string companyId FK
        string warehouseId FK
        string status "DRAFT | APPLIED | CANCELLED"
        string notes
        string createdBy FK
        string appliedBy FK
        datetime appliedAt
        datetime createdAt
    }
    STOCKTAKE_LINE {
        string lineId PK
        string stocktakeId FK
        string productId FK
        int systemQuantity "captured at creation"
        int countedQuantity
        int variance "counted - system"
    }
```

## Entities

| Entity | Lives in | What it is | Key rules enforced by the mock store |
| --- | --- | --- | --- |
| `COMPANY` | `packages/shared/src/seed` | The tenant ("Acme Trading Co."). Single company in v1; every business row carries its id. | All data is scoped to it. |
| `ROLE` | seed roles | Named permission bundle: `ADMIN`, `ACCOUNTANT`, `STOREKEEPER`, `VIEWER`. | Permissions are a flattened list per role (Stage B normalizes into `permissions` + `role_permissions` tables). |
| `USER` | seed users | A sign-in identity with email, name and one assigned role. | Login resolves the email alone, so it is globally unique and stored lowercase (case-insensitive uniqueness) — an address can never identify two tenants. Wrong password, unknown email and inactive user all fail with `INVALID_CREDENTIALS` after the same password check. |
| `ACCOUNT` | `accounts` state | Chart-of-accounts node; self-referencing tree via `parentAccountId`. | Unique code (`DUPLICATE_CODE`); parent assignment must not create a cycle (`INVALID_PARENT`); `accountType` is fixed once journal lines exist (`ACCOUNT_TYPE_IN_USE`); cannot be deleted while it has children or journal lines (`ACCOUNT_IN_USE`). |
| `PRODUCT` | `products` state | Item catalog entry (SKU, unit of measure, reorder threshold, running weighted-average cost). | Unique SKU (`DUPLICATE_SKU`); cannot be deleted with stock on hand or movement history (`PRODUCT_IN_USE`); `averageCost` is maintained by receipts and drives issue/adjustment valuation. |
| `WAREHOUSE` | `warehouses` state | Stock-keeping location. | Unique code; cannot be deleted while holding stock or having movement history (`WAREHOUSE_IN_USE`). |
| `INVENTORY_STOCK` | `stock` rows | Per-(product, warehouse) quantity bucket. Created lazily on first movement. | `quantityOnHand` can never go negative (DB CHECK mirrored in code). |
| `INVENTORY_TRANSACTION` | `movements` list | Append-only movement ledger. Signed quantity: positive = in, negative = out. | Rows are never updated or deleted — new facts are new rows. |
| `JOURNAL_ENTRY` | `journals` list | Double-entry document with a draft → posted lifecycle; posted entries are reversed, never rewritten. | ≥ 2 lines with positive amounts; `POSTED` requires Σ debits = Σ credits; posted entries are immutable; voiding one posts a linked `REVERSAL` entry. |
| `JOURNAL_ENTRY_LINE` | entry lines | One debit or credit against an account. | Amount always positive; side is `DEBIT` or `CREDIT`. |
| `STOCKTAKE` | `stocktakes` state | Warehouse count sheet (cycle/physical count) with a draft → applied lifecycle. | Draft captures system quantities, counted quantities and variances per product; only `DRAFT` can be applied. Applying posts `ADJUSTMENT` movements and balanced GL entries for non-zero variances (auditable, no direct ledger edits) and records `appliedBy`/`appliedAt`. |
| `STOCKTAKE_LINE` | stocktake lines | One counted product line within a stocktake. | Holds captured `systemQuantity`, `countedQuantity` and `variance` (`counted - system`); one line per (stocktake, product). |

## Relationships

| From | To | Cardinality | Meaning |
| --- | --- | --- | --- |
| `COMPANY` | `USER` / `ROLE` / `ACCOUNT` / `PRODUCT` / `WAREHOUSE` / `JOURNAL_ENTRY` / `STOCKTAKE` | 1 : N | Tenant scoping — every record belongs to one company. |
| `USER` | `ROLE` | N : 1 | Each user has exactly one role in v1 (assignable in Settings). |
| `USER` | `JOURNAL_ENTRY`, `INVENTORY_TRANSACTION`, `STOCKTAKE` | 1 : N | Audit: who created/recorded the record (`createdBy` + display name) and, for stocktakes, who applied it. |
| `ACCOUNT` | `ACCOUNT` | 0..1 parent : N children | Chart-of-accounts hierarchy. |
| `JOURNAL_ENTRY` | `JOURNAL_ENTRY_LINE` | 1 : 2..N | A journal always has at least two lines. |
| `JOURNAL_ENTRY_LINE` | `ACCOUNT` | N : 1 | Every line posts to exactly one ledger account. |
| `JOURNAL_ENTRY` | `INVENTORY_TRANSACTION` | 0..1 : 1 | Inventory operations (receipts, issues, adjustments/stocktake variances) auto-generate a POSTED entry referencing the movement (`referenceType` + `referenceId`). |
| `PRODUCT` + `WAREHOUSE` | `INVENTORY_STOCK` | 1 : N each | Stock is the join between a product and a warehouse — one row per pair. |
| `PRODUCT` / `WAREHOUSE` | `INVENTORY_TRANSACTION` | 1 : N | Each movement touches exactly one product in exactly one warehouse. |
| `WAREHOUSE` | `STOCKTAKE` | 1 : N | Each stocktake counts one warehouse. |
| `STOCKTAKE` | `STOCKTAKE_LINE` | 1 : 1..N | A stocktake records one or more counted product lines. |
| `PRODUCT` | `STOCKTAKE_LINE` | 1 : N | Each line captures the count for one product. |

## Integration account mapping

Inventory operations post journal entries against fixed system accounts
(`SYSTEM_ACCOUNT_CODES` in `packages/shared`):

| Operation | Debit | Credit |
| --- | --- | --- |
| Goods receipt | `1200` Inventory | `2000` Accounts Payable |
| Sales issue | `5000` Cost of Goods Sold | `1200` Inventory |
| Adjustment loss | `5100` Operating Expenses | `1200` Inventory |
| Adjustment gain | `1200` Inventory | `5100` Operating Expenses |
| Transfer | — (same inventory account) | — |

Zero-value receipts, issues and adjustments post nothing; they are logged in the
movement ledger only.
