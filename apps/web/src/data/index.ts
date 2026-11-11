import type {
  Account,
  AccountFilter,
  AdjustmentInput,
  AuthUser,
  CreateAccountInput,
  CreateJournalInput,
  CreateProductInput,
  CreateWarehouseInput,
  DashboardStats,
  InventoryStock,
  InventoryTransaction,
  IssueInput,
  JournalEntry,
  JournalFilter,
  LoginInput,
  LoginResponse,
  MovementFilter,
  Product,
  ProductFilter,
  ReceiptInput,
  StockFilter,
  TransferInput,
  TrialBalanceFilter,
  TrialBalanceRow,
  UpdateAccountInput,
  UpdateJournalInput,
  UpdateProductInput,
  UpdateWarehouseInput,
  Warehouse,
  WarehouseFilter,
} from '@erp/shared';

/**
 * The single data interface the UI is written against. Two implementations exist:
 * `mock` (in-memory, Stage A) and `http` (real API, Stage C). Swapping is a
 * `VITE_DATA_SOURCE` change only — no page imports either implementation directly.
 */

export interface AuthApi {
  login(input: LoginInput): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<AuthUser>;
  refresh(): Promise<LoginResponse>;
}

export interface AccountsApi {
  list(filter?: AccountFilter): Promise<Account[]>;
  get(accountId: string): Promise<Account>;
  create(input: CreateAccountInput): Promise<Account>;
  update(accountId: string, input: UpdateAccountInput): Promise<Account>;
  remove(accountId: string): Promise<void>;
}

export interface JournalsApi {
  list(filter?: JournalFilter): Promise<JournalEntry[]>;
  get(entryId: string): Promise<JournalEntry>;
  create(input: CreateJournalInput): Promise<JournalEntry>;
  update(entryId: string, input: UpdateJournalInput): Promise<JournalEntry>;
  post(entryId: string): Promise<JournalEntry>;
  void(entryId: string): Promise<JournalEntry>;
}

export interface ProductsApi {
  list(filter?: ProductFilter): Promise<Product[]>;
  get(productId: string): Promise<Product>;
  create(input: CreateProductInput): Promise<Product>;
  update(productId: string, input: UpdateProductInput): Promise<Product>;
  remove(productId: string): Promise<void>;
}

export interface WarehousesApi {
  list(filter?: WarehouseFilter): Promise<Warehouse[]>;
  get(warehouseId: string): Promise<Warehouse>;
  create(input: CreateWarehouseInput): Promise<Warehouse>;
  update(warehouseId: string, input: UpdateWarehouseInput): Promise<Warehouse>;
  remove(warehouseId: string): Promise<void>;
}

export interface InventoryApi {
  stock(filter?: StockFilter): Promise<InventoryStock[]>;
  movements(filter?: MovementFilter): Promise<InventoryTransaction[]>;
  receipt(input: ReceiptInput): Promise<InventoryTransaction>;
  issue(input: IssueInput): Promise<InventoryTransaction>;
  transfer(input: TransferInput): Promise<InventoryTransaction[]>;
  adjust(input: AdjustmentInput): Promise<InventoryTransaction>;
}

export interface ReportsApi {
  trialBalance(filter: TrialBalanceFilter): Promise<TrialBalanceRow[]>;
  dashboard(): Promise<DashboardStats>;
}

export interface DataSource {
  auth: AuthApi;
  accounts: AccountsApi;
  journals: JournalsApi;
  products: ProductsApi;
  warehouses: WarehousesApi;
  inventory: InventoryApi;
  reports: ReportsApi;
}
