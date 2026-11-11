import type { DataSource } from '../index';
import { MockStore } from './store';

/** Assemble the `DataSource` surface from the in-memory store. */
export function createMockDataSource(options: { latency?: number } = {}): DataSource {
  const store = new MockStore(options);

  return {
    auth: {
      login: (input) => store.login(input),
      logout: () => store.logout(),
      me: () => store.me(),
      refresh: () => store.refresh(),
    },
    accounts: {
      list: (filter) => store.listAccounts(filter),
      get: (id) => store.getAccount(id),
      create: (input) => store.createAccount(input),
      update: (id, input) => store.updateAccount(id, input),
      remove: (id) => store.removeAccount(id),
    },
    journals: {
      list: (filter) => store.listJournals(filter),
      get: (id) => store.getJournal(id),
      create: (input) => store.createJournal(input),
      update: (id, input) => store.updateJournal(id, input),
      post: (id) => store.postJournal(id),
      void: (id) => store.voidJournal(id),
    },
    products: {
      list: (filter) => store.listProducts(filter),
      get: (id) => store.getProduct(id),
      create: (input) => store.createProduct(input),
      update: (id, input) => store.updateProduct(id, input),
      remove: (id) => store.removeProduct(id),
    },
    warehouses: {
      list: (filter) => store.listWarehouses(filter),
      get: (id) => store.getWarehouse(id),
      create: (input) => store.createWarehouse(input),
      update: (id, input) => store.updateWarehouse(id, input),
      remove: (id) => store.removeWarehouse(id),
    },
    inventory: {
      stock: (filter) => store.listStock(filter),
      movements: (filter) => store.listMovements(filter),
      receipt: (input) => store.receipt(input),
      issue: (input) => store.issue(input),
      transfer: (input) => store.transfer(input),
      adjust: (input) => store.adjust(input),
    },
    reports: {
      trialBalance: (filter) => store.trialBalance(filter),
      dashboard: () => store.dashboard(),
    },
    users: {
      list: () => store.listUsers(),
      listRoles: () => store.listRoles(),
      assignRole: (userId, input) => store.assignRole(userId, input),
    },
  };
}

export { MockStore } from './store';
