# Operations & Workflows (Stage A)

> Documents the workflows a user can actually drive in `apps/web` as built in
> Phase A (mock data source). Every rule shown here is enforced by the mock
> store, so it matches what Stage B's database will enforce.

## 1. Signing in and session handling

```mermaid
flowchart TD
    A["Open the app"] --> B{"Auth context<br/>restores session"}
    B -- "stored session is valid" --> C["Protected UI (AppShell)"]
    B -- "no session / me() fails" --> D["Login page"]
    D --> E["Submit email + password"]
    E --> F{"Credentials valid?"}
    F -- "no: INVALID_CREDENTIALS" --> D
    F -- "yes" --> G["Persist tokens + current user"]
    G --> C
    C --> H["Sign out from the user menu"]
    H --> I["Session cleared,<br/>query cache purged"]
    I --> D
```

- Tokens (`mock-access.*`) are stored in `localStorage` (`src/auth/tokenStorage.ts`) — the same place the Stage C HTTP client will read them from.
- The mock store persists the current user id so a page reload keeps the session.

## 2. Route protection

```mermaid
flowchart TD
    R["Protected route: RequireAuth"] --> S{"Auth status?"}
    S -- "loading" --> T["Full-screen spinner"]
    S -- "anonymous" --> U["Redirect to /login<br/>(remembers the origin path)"]
    S -- "authenticated" --> V["Render AppShell + page"]
    U --> W["After login: return to<br/>the originally requested page"]
```

## 3. Role-based access control (RBAC)

```mermaid
flowchart LR
    U["Signed-in user"] --> R["Role"]
    R --> P["Flattened<br/>permission set"]
    P --> N{"can(permission)?"}
    N -- "yes" --> M["Menu item / action button rendered"]
    N -- "no" --> H["Hidden entirely"]
```

What each seeded role can see (permissions from `packages/shared`):

| Role | Dashboard | Accounting | Inventory | Operations (write) | Settings |
| --- | --- | --- | --- | --- | --- |
| `ADMIN` | ✔ | full + write | full + write | ✔ | users + role assignment |
| `ACCOUNTANT` | ✔ | full + write | read only | ✖ (read-only notice) | ✖ hidden |
| `STOREKEEPER` | ✔ | ✖ hidden | full + write | ✔ | ✖ hidden |
| `VIEWER` | ✔ | read only | read only | ✖ | ✖ hidden |

## 4. Journal entry lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT : create (save draft)
    DRAFT --> DRAFT : edit date / reference / lines
    DRAFT --> POSTED : post — requires Σ debits = Σ credits
    DRAFT --> VOIDED : void
    POSTED --> VOIDED : void
    POSTED --> POSTED : immutable (edit rejected: ENTRY_NOT_EDITABLE)
    VOIDED --> [*]
```

- Only drafts can be edited (`ENTRY_NOT_EDITABLE`) and only drafts can be posted (`ENTRY_NOT_POSTABLE`).
- `VOIDED` is terminal — voiding again is rejected (`ENTRY_ALREADY_VOID`).

## 5. Creating and posting a journal entry

```mermaid
flowchart TD
    A["Journal editor<br/>(/accounting/journals/new)"] --> B["Add lines:<br/>account, debit/credit, amount"]
    B --> C{"Live balance check"}
    C -- "Σ debits = Σ credits" --> D["Indicator green:<br/>Balanced"]
    C -- "difference" --> E["Indicator orange:<br/>Out of balance by X"]
    E --> B
    D --> F["Save as DRAFT"]
    F --> G["Journal list — Post action"]
    G --> H{"Store re-checks balance<br/>and line well-formedness"}
    H -- "≥ 2 lines, amounts > 0,<br/>balanced" --> I["POSTED — postedAt set,<br/>trial balance updated"]
    H -- "unbalanced" --> J["Rejected: UNBALANCED_ENTRY"]
```

- Drafts are allowed to be unbalanced; the guard fires only at `post()`.
- The same editor page handles create (`new`) and edit (`:entryId/edit`, drafts only).

## 6. Chart of accounts maintenance

```mermaid
flowchart TD
    A["Accounts page (tree table)"] --> B["Create / edit in drawer"]
    B --> C{"Code unique?<br/>Parent exists?"}
    C -- "no" --> D["Reject: DUPLICATE_CODE<br/>or INVALID_PARENT"]
    C -- "yes" --> E["Saved — tree re-renders"]
    F["Delete account"] --> G{"Has children<br/>or journal lines?"}
    G -- "yes" --> H["Reject: ACCOUNT_IN_USE"]
    G -- "no" --> I["Removed"]
```

## 7. Goods receipt (Inventory → General Ledger integration)

```mermaid
sequenceDiagram
    actor U as User (inventory:write)
    participant P as Receipt form
    participant S as MockStore
    participant ST as InventoryStock
    participant M as Movements ledger
    participant J as JournalEntry

    U->>P: product, warehouse, qty, unit cost
    P->>S: inventory.receipt()
    S->>ST: quantityOnHand += qty
    S->>M: append GOODS_RECEIPT (+qty, unitCost)
    S->>J: create POSTED entry<br/>DR 1200 Inventory / CR 2000 AP = qty × cost
    S-->>P: movement + updated stock
```

One operation produces **one stock increase, one append-only movement, and one balanced POSTED journal entry**.

## 8. Sales issue

```mermaid
flowchart TD
    A["Issue form"] --> B{"Stock on hand<br/>≥ quantity?"}
    B -- "no" --> C["Reject: INSUFFICIENT_STOCK<br/>(clear message with available qty)"]
    B -- "yes" --> D["quantityOnHand -= qty"]
    D --> E["Append SALES_ISSUE movement (-qty)"]
    E --> F["Auto-post DR 5000 COGS / CR 1200 Inventory"]
```

## 9. Warehouse transfer

```mermaid
flowchart TD
    A["Transfer form"] --> B{"Source ≠ destination<br/>and enough stock?"}
    B -- "no" --> C["Reject (form rule or<br/>INSUFFICIENT_STOCK)"]
    B -- "yes" --> D["Source: quantityOnHand -= qty"]
    D --> E["Destination: quantityOnHand += qty<br/>(row created lazily if new)"]
    E --> F["Append paired movements:<br/>TRANSFER_OUT (-qty) + TRANSFER_IN (+qty)"]
    F --> G["No journal entry in v1"]
```

## 10. Stock adjustment

```mermaid
flowchart TD
    A["Adjustment form<br/>(reason required)"] --> B{"Delta ≠ 0 and<br/>result ≥ 0?"}
    B -- "no" --> C["Reject: INSUFFICIENT_STOCK"]
    B -- "yes" --> D["Apply delta to stock"]
    D --> E["Append ADJUSTMENT movement"]
    E --> F["No journal entry in v1"]
```

## 11. Assigning a role (Settings)

```mermaid
flowchart TD
    A["Users & Roles page"] --> B["Pick user → Manage access"]
    B --> C["Choose role in drawer"]
    C --> D["users.assignRole()"]
    D --> E["Role + permission set updated<br/>(menus re-filter on next sign-in)"]
```

## 12. Reports

- **Trial balance** — aggregates lines of `POSTED` entries in a date range, grouped by account; the net column sums to zero across all accounts; exportable as CSV.
- **Dashboard** — counts (accounts, products, journals, stock units), draft/posted split, low-stock items (`quantityOnHand ≤ reorderThreshold`) and the five most recent journals.

## Invariants enforced by the mock store (summary)

| # | Rule | Error surfaced |
| --- | --- | --- |
| 1 | Journal needs ≥ 2 lines with positive amounts | `INVALID_ENTRY` |
| 2 | Posting requires Σ debits = Σ credits | `UNBALANCED_ENTRY` |
| 3 | Posted entries are immutable; only drafts are editable/postable | `ENTRY_NOT_EDITABLE` / `ENTRY_NOT_POSTABLE` |
| 4 | Stock never goes negative (issue, transfer, adjustment) | `INSUFFICIENT_STOCK` |
| 5 | Movement ledger and posted entries are append-only | — (no edit/delete paths exist) |
| 6 | Account codes, SKUs and warehouse codes are unique | `DUPLICATE_CODE` / `DUPLICATE_SKU` |
| 7 | Referential guards: accounts with children/lines, products with stock/history, warehouses with stock/history cannot be deleted | `ACCOUNT_IN_USE` / `PRODUCT_IN_USE` / `WAREHOUSE_IN_USE` |
| 8 | Every mutation requires a signed-in user | `UNAUTHENTICATED` |
