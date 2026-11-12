import type {
  Account,
  AccountFilter,
  AdjustmentInput,
  AdminUser,
  AssignRoleInput,
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
  RoleInfo,
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
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { DataSource } from '../index';
import { createApiClient } from './client';
import { getRefreshToken } from '@/auth/tokenStorage';

/**
 * The real-API implementation of `DataSource`. Every method is one HTTP call to
 * `/api/v1` whose JSON body already matches the shared TypeScript types — the
 * API serializes exactly this contract, so no mapping is needed.
 */

const boolParam = (value?: boolean): string | undefined =>
  value === undefined ? undefined : String(value);

async function request<T>(
  client: AxiosInstance,
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  body?: unknown,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const config: AxiosRequestConfig = { method, url };
  if (body !== undefined) config.data = body;
  if (params) config.params = params;
  const { data } = await client.request<T>(config);
  return data;
}

export function createHttpDataSource(
  options: { baseURL?: string; adapter?: AxiosRequestConfig['adapter'] } = {},
): DataSource {
  const { client, refreshSession } = createApiClient({
    baseURL: options.baseURL ?? import.meta.env.VITE_API_URL ?? '/api/v1',
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  const get = <T>(url: string, params?: Record<string, string | undefined>) =>
    request<T>(client, 'get', url, undefined, params);
  const post = <T>(url: string, body?: unknown) => request<T>(client, 'post', url, body);
  const patch = <T>(url: string, body: unknown) => request<T>(client, 'patch', url, body);
  const del = (url: string) => request<void>(client, 'delete', url);

  return {
    auth: {
      login: (input: LoginInput) => post<LoginResponse>('/auth/login', input),
      // Revocation is best-effort; AuthContext clears the local session either way.
      logout: async () => {
        try {
          await post('/auth/logout', { refreshToken: getRefreshToken() ?? undefined });
        } catch {
          // Already revoked / refresh failed — the session is discarded locally.
        }
      },
      me: () => get<AuthUser>('/auth/me'),
      refresh: () => refreshSession(),
    },
    accounts: {
      list: (filter: AccountFilter = {}) =>
        get<Account[]>('/accounts', {
          type: filter.type,
          active: boolParam(filter.active),
          search: filter.search,
        }),
      get: (accountId) => get<Account>(`/accounts/${accountId}`),
      create: (input: CreateAccountInput) => post<Account>('/accounts', input),
      update: (accountId, input: UpdateAccountInput) => patch<Account>(`/accounts/${accountId}`, input),
      remove: (accountId) => del(`/accounts/${accountId}`),
    },
    journals: {
      list: (filter: JournalFilter = {}) =>
        get<JournalEntry[]>('/journals', {
          status: filter.status,
          referenceType: filter.referenceType,
          from: filter.from,
          to: filter.to,
          search: filter.search,
        }),
      get: (entryId) => get<JournalEntry>(`/journals/${entryId}`),
      create: (input: CreateJournalInput) => post<JournalEntry>('/journals', input),
      update: (entryId, input: UpdateJournalInput) => patch<JournalEntry>(`/journals/${entryId}`, input),
      post: (entryId) => post<JournalEntry>(`/journals/${entryId}/post`, {}),
      void: (entryId) => post<JournalEntry>(`/journals/${entryId}/void`, {}),
    },
    products: {
      list: (filter: ProductFilter = {}) =>
        get<Product[]>('/products', { search: filter.search, active: boolParam(filter.active) }),
      get: (productId) => get<Product>(`/products/${productId}`),
      create: (input: CreateProductInput) => post<Product>('/products', input),
      update: (productId, input: UpdateProductInput) => patch<Product>(`/products/${productId}`, input),
      remove: (productId) => del(`/products/${productId}`),
    },
    warehouses: {
      list: (filter: WarehouseFilter = {}) =>
        get<Warehouse[]>('/warehouses', { search: filter.search, active: boolParam(filter.active) }),
      get: (warehouseId) => get<Warehouse>(`/warehouses/${warehouseId}`),
      create: (input: CreateWarehouseInput) => post<Warehouse>('/warehouses', input),
      update: (warehouseId, input: UpdateWarehouseInput) =>
        patch<Warehouse>(`/warehouses/${warehouseId}`, input),
      remove: (warehouseId) => del(`/warehouses/${warehouseId}`),
    },
    inventory: {
      stock: (filter: StockFilter = {}) =>
        get<InventoryStock[]>('/inventory/stock', {
          productId: filter.productId,
          warehouseId: filter.warehouseId,
          // The API treats any truthy value as "low stock only" — omit when false.
          lowStock: filter.lowStock ? 'true' : undefined,
          search: filter.search,
        }),
      movements: (filter: MovementFilter = {}) =>
        get<InventoryTransaction[]>('/inventory/movements', {
          productId: filter.productId,
          warehouseId: filter.warehouseId,
          movementType: filter.movementType,
          from: filter.from,
          to: filter.to,
        }),
      receipt: (input: ReceiptInput) => post<InventoryTransaction>('/inventory/receipts', input),
      issue: (input: IssueInput) => post<InventoryTransaction>('/inventory/issues', input),
      transfer: (input: TransferInput) => post<InventoryTransaction[]>('/inventory/transfers', input),
      adjust: (input: AdjustmentInput) => post<InventoryTransaction>('/inventory/adjustments', input),
    },
    reports: {
      trialBalance: (filter: TrialBalanceFilter) =>
        get<TrialBalanceRow[]>('/reports/trial-balance', { from: filter.from, to: filter.to }),
      dashboard: () => get<DashboardStats>('/reports/dashboard'),
    },
    users: {
      list: () => get<AdminUser[]>('/users'),
      listRoles: () => get<RoleInfo[]>('/users/roles'),
      assignRole: (userId, input: AssignRoleInput) => post<AdminUser>(`/users/${userId}/role`, input),
    },
  };
}
