# Client Architecture (Stage A)

> How `apps/web` is wired as built in Phase A. The key property: every page
> talks to a **single `DataSource` interface**, so swapping the in-memory mock
> for the real HTTP API (Stage C) is a one-line env change.

## 1. Bootstrap chain (`main.tsx`)

```mermaid
flowchart TD
    EB["ErrorBoundary<br/>(crash screen)"] --> CFG["ConfigProvider<br/>(Ant Design theme)"]
    CFG --> AAPP["AntApp<br/>(message/notification context)"]
    AAPP --> QCP["QueryClientProvider<br/>(TanStack Query)"]
    QCP --> AP["AuthProvider<br/>(session restore on boot)"]
    AP --> RP["RouterProvider"]
```

## 2. Layers

```mermaid
flowchart TD
    subgraph UI["Feature pages — src/pages/"]
        P1["Dashboard"]
        P2["Accounting: accounts, journals, editor, trial balance"]
        P3["Inventory: products, warehouses, stock, movements, operations"]
        P4["Auth: login page"]
        P5["Settings: users & roles"]
    end

    subgraph State["Client state"]
        Q["TanStack Query cache<br/>(lists + reports, keyed by filters)"]
        AC["AuthContext<br/>(user, status, permissions)"]
        SH["AppShell<br/>(permission-filtered nav + user menu)"]
    end

    subgraph Data["Data layer — src/data/"]
        DC["client.ts<br/>picks implementation from VITE_DATA_SOURCE"]
        IF["DataSource interface<br/>(auth, accounts, journals, products,<br/>warehouses, inventory, reports, users)"]
        MS["MockStore<br/>in-memory, invariant-enforcing"]
        HS["http/ stub — throws until Stage C"]
    end

    subgraph Shared["packages/shared — frozen contracts"]
        ZD["zod schemas + DTO types"]
        SD["seed dataset"]
        CO["enums, permission catalog,<br/>system account codes"]
    end

    P4 --> AC
    SH --> AC
    UI --> Q
    Q --> DC
    DC --> IF
    IF --> MS
    IF -.->|"VITE_DATA_SOURCE=http (Stage C)"| HS
    MS --> SD
    MS --> ZD
    UI --> CO
```

## 3. Read path (queries)

```mermaid
sequenceDiagram
    participant Pg as Page
    participant Q as TanStack Query
    participant DS as DataSource (mock)

    Pg->>Q: useQuery(key, () => data.x.list(filter))
    Q->>DS: call (first render / cache miss)
    DS-->>Q: data (after simulated latency)
    Q-->>Pg: data / isLoading
    Note over Q: refetch only when the key changes<br/>or after an invalidation
```

- Query keys encode the resource **and its filters** (e.g. `['stock', filter]`), so changing a filter is a different cache entry, not a mutation.
- `DataError` with `status < 500` is never retried; transient failures retry twice.

## 4. Write path (mutations + invalidation)

```mermaid
sequenceDiagram
    actor U as User
    participant Pg as Page (Drawer/Form)
    participant Q as TanStack Query
    participant DS as DataSource (mock)

    U->>Pg: submit form
    Pg->>Q: useMutation(call)
    Q->>DS: e.g. data.inventory.receipt(input)
    DS-->>Q: result entity
    alt success
        Q-->>Pg: onSuccess → success message<br/>+ invalidateQueries(['stock'], ['movements'], ...)
        Q->>DS: refetch affected lists
    else DataError
        Q-->>Pg: onError → antd message with error.message<br/>(e.g. INSUFFICIENT_STOCK)
    end
```

## 5. Routing map

```mermaid
flowchart LR
    ROOT["/"] -->|"RequireAuth wraps everything below"| LOGIN["/login (public)"]
    ROOT --> DASH["/dashboard"]
    ROOT --> ACC["/accounting<br/>accounts · journals · journals/new · journals/:id/edit · trial-balance"]
    ROOT --> INV["/inventory<br/>products · warehouses · stock · movements · operations"]
    ROOT --> SET["/settings/access"]
    ROOT --> NF["* → 404 placeholder"]
```

## 6. Environment flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | `mock` | `mock` → in-memory store; `http` → real API (Stage C). |
| `VITE_MOCK_LATENCY` | `250` | Simulated latency (ms) so loading states are real. |
| `VITE_API_URL` | `/api/v1` | API base URL used by the HTTP source (Stage C). |

## 7. Module map

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Bootstrap chain (§1). |
| `src/router.tsx` | Route table; public `/login`, guarded app routes. |
| `src/auth/` | `AuthProvider` (session, login/logout, token storage), `RequireAuth`, `usePermission`. |
| `src/layouts/AppShell.tsx` | Sidebar (nav filtered by permissions), header (company, data-source tag, user menu). |
| `src/data/index.ts` | The `DataSource` contract — the only data surface pages may use. |
| `src/data/client.ts` | Chooses the implementation from `VITE_DATA_SOURCE`. |
| `src/data/mock/` | `MockStore`: seeded in-memory state + all domain invariants. |
| `src/data/http/` | Stub; implemented in Stage C with axios + refresh interceptor. |
| `src/pages/` | One folder per feature (accounts, journals, trialBalance, products, warehouses, stock, movements, operations, settings). |
| `src/lib/` | Query client, money/date formatters, journal totals math, CSV download. |
| `src/components/` | `PageHeader`, `ErrorBoundary`. |
