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
      stocktakes: (warehouseId) => store.listStocktakes(warehouseId),
      stocktake: (id) => store.getStocktake(id),
      createStocktake: (input) => store.createStocktake(input),
      applyStocktake: (id) => store.applyStocktake(id),
    },
    reports: {
      trialBalance: (filter) => store.trialBalance(filter),
      accountLedger: (accountId, filter) => store.accountLedger(accountId, filter),
      profitAndLoss: (filter) => store.profitAndLoss(filter),
      balanceSheet: (filter) => store.balanceSheet(filter),
      cashFlow: (filter) => store.cashFlow(filter),
      inventoryValuation: () => store.inventoryValuation(),
      inventoryMovementSummary: (filter) => store.inventoryMovementSummary(filter),
      inventoryAging: (filter) => store.inventoryAging(filter),
      dashboard: () => store.dashboard(),
    },
    fiscal: {
      listYears: () => store.listFiscalYears(),
      createYear: (input) => store.createFiscalYear(input),
      createPeriod: (fiscalYearId, input) => store.createFiscalPeriod(fiscalYearId, input),
      closePeriod: (periodId) => store.closeFiscalPeriod(periodId),
      reopenPeriod: (periodId, input) => store.reopenFiscalPeriod(periodId, input),
      yearEndClose: (fiscalYearId) => store.yearEndClose(fiscalYearId),
      events: () => store.listFiscalEvents(),
    },
    users: {
      list: () => store.listUsers(),
      listRoles: () => store.listRoles(),
      assignRole: (userId, input) => store.assignRole(userId, input),
    },
  };
}

export { MockStore } from './store';
