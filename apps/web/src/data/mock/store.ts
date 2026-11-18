import {
  Decimal,
  money,
  moneyToNumber,
  seed,
  seedCreatedAt,
  sumMoney,
  type Account,
  type AccountFilter,
  type AccountLedgerFilter,
  type AccountLedgerReport,
  type AdjustmentInput,
  type BalanceSheetFilter,
  type BalanceSheetReport,
  type CashFlowStatementReport,
  type AuthUser,
  type CreateAccountInput,
  type CreateFiscalPeriodInput,
  type CreateFiscalYearInput,
  type CreateJournalInput,
  type CreateProductInput,
  type CreateStocktakeInput,
  type CreateWarehouseInput,
  type DashboardStats,
  type EntryType,
  type FinancialStatementFilter,
  type FiscalEvent,
  type FiscalPeriod,
  type FiscalYear,
  type InventoryAgingFilter,
  type InventoryAgingReport,
  type InventoryMovementSummaryFilter,
  type InventoryMovementSummaryReport,
  type InventoryStock,
  type InventoryTransaction,
  type InventoryValuationReport,
  type IssueInput,
  type JournalEntry,
  type JournalEntryLine,
  type JournalFilter,
  type JournalStatus,
  type LoginInput,
  type LoginResponse,
  type MovementFilter,
  type MovementType,
  type Product,
  type ProductFilter,
  type ProfitAndLossReport,
  type ReceiptInput,
  type ReopenPeriodInput,
  type StockFilter,
  type Stocktake,
  type StocktakeLine,
  type StocktakeStatus,
  type TransferInput,
  type TrialBalanceFilter,
  type TrialBalanceRow,
  type UpdateAccountInput,
  type UpdateJournalInput,
  type UpdateProductInput,
  type UpdateWarehouseInput,
  type Warehouse,
  type WarehouseFilter,
  REVERSAL_REFERENCE_TYPE,
  signedMovementQuantity,
  SYSTEM_ACCOUNT_CODES,
} from '@erp/shared';
import { DataError } from '../errors';
import type { AdminUser, AssignRoleInput, RoleInfo } from '@erp/shared';

interface StockRow {
  stockId: string;
  productId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
  updatedAt: string;
}

interface MovementRow {
  transactionId: string;
  productId: string;
  warehouseId: string;
  movementType: MovementType;
  quantity: number;
  unitCost: number;
  referenceId: string | null;
  createdBy: string;
  createdAt: string;
}

interface NewJournalInput {
  entryDate: string;
  referenceType: string | null;
  referenceId: string | null;
  status: JournalStatus;
  lines: { accountId: string; entryType: EntryType; amount: number; description: string | null }[];
}

interface StocktakeLineRow {
  lineId: string;
  productId: string;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
}

interface StocktakeRow {
  stocktakeId: string;
  warehouseId: string;
  status: StocktakeStatus;
  notes: string | null;
  createdBy: string;
  appliedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
  lines: StocktakeLineRow[];
}

interface FiscalPeriodRow {
  periodId: string;
  fiscalYearId: string;
  name: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  closedBy: string | null;
}

interface FiscalYearRow {
  fiscalYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  closedBy: string | null;
  closingEntryId: string | null;
  createdAt: string;
}

interface FiscalEventRow {
  eventId: string;
  fiscalYearId: string | null;
  periodId: string | null;
  action: FiscalEvent['action'];
  reason: string | null;
  actorUserId: string;
  createdAt: string;
}

const uid = (): string => globalThis.crypto.randomUUID();
const today = (): string => new Date().toISOString().slice(0, 10);

const SESSION_STORAGE_KEY = 'erp.mock.currentUserId';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory data source used across Stage A. It mirrors the database rules from
 * `dev/docs/erd.md`: journals must balance before posting, and stock can never go
 * negative. Keeping those rules here means the UI is validated against honest
 * behavior, not a permissive fake.
 */
export class MockStore {
  private readonly latency: number;

  private accounts: Account[];
  private products: Product[];
  private warehouses: Warehouse[];
  private stock: StockRow[];
  private movements: MovementRow[];
  private journals: JournalEntry[];
  private users: { userId: string; roleCode: string; isActive: boolean }[];
  private stocktakes: StocktakeRow[];
  private fiscalYears: FiscalYearRow[];
  private fiscalPeriods: FiscalPeriodRow[];
  private fiscalEvents: FiscalEventRow[];

  private currentUserId: string | null = null;
  private journalCounter = seed.journals.length;

  constructor(options: { latency?: number } = {}) {
    this.latency = options.latency ?? 0;

    this.fiscalYears = [];
    this.fiscalPeriods = [];
    this.fiscalEvents = [];

    this.accounts = seed.accounts.map((a) => ({
      ...a,
      isActive: true,
      createdAt: seedCreatedAt,
    }));
    // Same starting valuation the API seeder/migration derives: inbound seed
    // movements set each product's weighted-average cost.
    const inbound = new Map<string, { quantity: number; value: Decimal }>();
    for (const movement of seed.movements) {
      if (movement.quantity <= 0) continue;
      if (movement.movementType !== 'GOODS_RECEIPT' && movement.movementType !== 'ADJUSTMENT') {
        continue;
      }
      const entry = inbound.get(movement.productId) ?? { quantity: 0, value: new Decimal(0) };
      entry.quantity += movement.quantity;
      entry.value = entry.value.plus(money(movement.quantity).times(movement.unitCost));
      inbound.set(movement.productId, entry);
    }
    this.products = seed.products.map((p) => {
      const basis = inbound.get(p.productId);
      return {
        ...p,
        averageCost:
          basis && basis.quantity > 0
            ? moneyToNumber(basis.value.dividedBy(basis.quantity))
            : 0,
        isActive: true,
        createdAt: seedCreatedAt,
      };
    });
    this.warehouses = seed.warehouses.map((w) => ({
      ...w,
      isActive: true,
      createdAt: seedCreatedAt,
    }));
    this.stock = seed.stock.map((s) => ({
      stockId: uid(),
      productId: s.productId,
      warehouseId: s.warehouseId,
      quantityOnHand: s.quantityOnHand,
      quantityReserved: s.quantityReserved,
      updatedAt: seedCreatedAt,
    }));
    this.movements = seed.movements.map((m) => ({ ...m }));
    this.journals = seed.journals.map((j) => this.buildEntry(j));
    this.users = seed.users.map((u) => ({ userId: u.userId, roleCode: u.roleCode, isActive: true }));
    this.stocktakes = [];

    this.restoreSession();
  }

  private async wait(): Promise<void> {
    if (this.latency > 0) await sleep(this.latency);
  }

  // ---------------------------------------------------------------- auth

  /** The signed-in user id survives page reloads so the SPA keeps its session. */
  private restoreSession(): void {
    try {
      const stored = globalThis.localStorage?.getItem(SESSION_STORAGE_KEY);
      if (stored && seed.users.some((u) => u.userId === stored)) {
        this.currentUserId = stored;
      }
    } catch {
      // Storage unavailable (e.g. some test environments) - stay signed out.
    }
  }

  private persistSession(): void {
    try {
      if (this.currentUserId) {
        globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, this.currentUserId);
      } else {
        globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Best-effort persistence; the in-memory state stays authoritative.
    }
  }

  private authUser(userId: string): AuthUser {
    const user = seed.users.find((u) => u.userId === userId);
    if (!user) throw new DataError('USER_NOT_FOUND', 'User not found', 404);
    const role = seed.roles.find((r) => r.code === user.roleCode);
    return {
      userId: user.userId,
      companyId: user.companyId,
      companyName: seed.company.name,
      email: user.email,
      fullName: user.fullName,
      roles: role ? [role.code] : [],
      permissions: role ? [...role.permissions] : [],
    };
  }

  /** Display name for a user id, used on audit columns. */
  private userName(userId: string): string {
    return seed.users.find((u) => u.userId === userId)?.fullName ?? userId;
  }

  private roleById(roleId: string): (typeof seed.roles)[number] {
    const role = seed.roles.find((r) => r.roleId === roleId);
    if (!role) throw new DataError('ROLE_NOT_FOUND', 'Role not found', 404);
    return role;
  }

  private toAdminUser(user: { userId: string; roleCode: string; isActive: boolean }): AdminUser {
    const seedUser = seed.users.find((u) => u.userId === user.userId);
    if (!seedUser) throw new DataError('USER_NOT_FOUND', 'User not found', 404);
    const role = seed.roles.find((r) => r.code === user.roleCode);
    return {
      userId: seedUser.userId,
      companyId: seedUser.companyId,
      email: seedUser.email,
      fullName: seedUser.fullName,
      isActive: user.isActive,
      roles: role
        ? [{ roleId: role.roleId, code: role.code, name: role.name, permissions: [...role.permissions] }]
        : [],
    };
  }

  async listUsers(): Promise<AdminUser[]> {
    await this.wait();
    return this.users
      .map((u) => this.toAdminUser(u))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async listRoles(): Promise<RoleInfo[]> {
    await this.wait();
    return seed.roles.map((r) => ({
      roleId: r.roleId,
      code: r.code,
      name: r.name,
      permissions: [...r.permissions],
    }));
  }

  async assignRole(userId: string, input: AssignRoleInput): Promise<AdminUser> {
    await this.wait();
    this.requireActor();
    const role = this.roleById(input.roleId);
    const user = this.users.find((u) => u.userId === userId);
    if (!user) throw new DataError('USER_NOT_FOUND', 'User not found', 404);
    user.roleCode = role.code;
    return this.toAdminUser(user);
  }

  async login(input: LoginInput): Promise<LoginResponse> {
    await this.wait();
    const user = seed.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
    if (!user || user.password !== input.password) {
      throw new DataError('INVALID_CREDENTIALS', 'Incorrect email or password', 401);
    }
    this.currentUserId = user.userId;
    this.persistSession();
    return {
      accessToken: `mock-access.${user.userId}`,
      refreshToken: `mock-refresh.${user.userId}`,
      user: this.authUser(user.userId),
    };
  }

  async logout(): Promise<void> {
    await this.wait();
    this.currentUserId = null;
    this.persistSession();
  }

  async me(): Promise<AuthUser> {
    await this.wait();
    if (!this.currentUserId) throw new DataError('UNAUTHENTICATED', 'Not signed in', 401);
    return this.authUser(this.currentUserId);
  }

  async refresh(): Promise<LoginResponse> {
    await this.wait();
    if (!this.currentUserId) throw new DataError('UNAUTHENTICATED', 'Not signed in', 401);
    return {
      accessToken: `mock-access.${this.currentUserId}`,
      refreshToken: `mock-refresh.${this.currentUserId}`,
      user: this.authUser(this.currentUserId),
    };
  }

  private requireActor(): string {
    if (!this.currentUserId) throw new DataError('UNAUTHENTICATED', 'Not signed in', 401);
    return this.currentUserId;
  }

  // ------------------------------------------------------------- fiscal

  private assertPeriodOpen(date: string): void {
    const closed = this.fiscalPeriods.find(
      (p) => p.status === 'CLOSED' && p.startDate <= date && p.endDate >= date,
    );
    if (closed) {
      throw new DataError(
        'PERIOD_LOCKED',
        `Date ${date} falls in closed period ${closed.name}`,
        422,
      );
    }
  }

  private fiscalYearById(fiscalYearId: string): FiscalYearRow {
    const year = this.fiscalYears.find((y) => y.fiscalYearId === fiscalYearId);
    if (!year) throw new DataError('FISCAL_YEAR_NOT_FOUND', 'Fiscal year not found', 404);
    return year;
  }

  private enrichFiscalPeriod(p: FiscalPeriodRow): FiscalPeriod {
    return {
      periodId: p.periodId,
      fiscalYearId: p.fiscalYearId,
      companyId: seed.company.companyId,
      name: p.name,
      periodNumber: p.periodNumber,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      closedAt: p.closedAt,
      closedBy: p.closedBy,
      closedByName: p.closedBy ? this.userName(p.closedBy) : null,
    };
  }

  private enrichFiscalYear(y: FiscalYearRow): FiscalYear {
    return {
      fiscalYearId: y.fiscalYearId,
      companyId: seed.company.companyId,
      name: y.name,
      startDate: y.startDate,
      endDate: y.endDate,
      status: y.status,
      closedAt: y.closedAt,
      closedBy: y.closedBy,
      closedByName: y.closedBy ? this.userName(y.closedBy) : null,
      periods: this.fiscalPeriods
        .filter((p) => p.fiscalYearId === y.fiscalYearId)
        .sort((a, b) => a.periodNumber - b.periodNumber)
        .map((p) => this.enrichFiscalPeriod(p)),
    };
  }

  async listFiscalYears(): Promise<FiscalYear[]> {
    await this.wait();
    return this.fiscalYears
      .slice()
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((y) => this.enrichFiscalYear(y));
  }

  async createFiscalYear(input: CreateFiscalYearInput): Promise<FiscalYear> {
    await this.wait();
    this.requireActor();
    if (this.fiscalYears.some((y) => y.startDate <= input.endDate && y.endDate >= input.startDate)) {
      throw new DataError('FISCAL_YEAR_OVERLAP', 'Fiscal year overlaps an existing year', 409);
    }
    if (this.fiscalYears.some((y) => y.name === input.name)) {
      throw new DataError('DUPLICATE_FISCAL_YEAR', `Fiscal year ${input.name} already exists`, 409);
    }
    const year: FiscalYearRow = {
      fiscalYearId: uid(),
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'OPEN',
      closedAt: null,
      closedBy: null,
      closingEntryId: null,
      createdAt: new Date().toISOString(),
    };
    this.fiscalYears.push(year);
    return this.enrichFiscalYear(year);
  }

  async createFiscalPeriod(fiscalYearId: string, input: CreateFiscalPeriodInput): Promise<FiscalPeriod> {
    await this.wait();
    this.requireActor();
    const year = this.fiscalYearById(fiscalYearId);
    if (input.startDate < year.startDate || input.endDate > year.endDate) {
      throw new DataError('PERIOD_OUT_OF_YEAR', 'Period must fall within its fiscal year', 422);
    }
    const yearPeriods = this.fiscalPeriods.filter((p) => p.fiscalYearId === fiscalYearId);
    if (yearPeriods.some((p) => p.periodNumber === input.periodNumber)) {
      throw new DataError('DUPLICATE_PERIOD_NUMBER', 'Period number already exists in this year', 409);
    }
    if (yearPeriods.some((p) => p.startDate <= input.endDate && p.endDate >= input.startDate)) {
      throw new DataError('FISCAL_PERIOD_OVERLAP', 'Period overlaps an existing period', 409);
    }
    const period: FiscalPeriodRow = {
      periodId: uid(),
      fiscalYearId,
      name: input.name,
      periodNumber: input.periodNumber,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'OPEN',
      closedAt: null,
      closedBy: null,
    };
    this.fiscalPeriods.push(period);
    return this.enrichFiscalPeriod(period);
  }

  async closeFiscalPeriod(periodId: string): Promise<FiscalPeriod> {
    await this.wait();
    const actor = this.requireActor();
    const period = this.fiscalPeriods.find((p) => p.periodId === periodId);
    if (!period) throw new DataError('PERIOD_NOT_FOUND', 'Fiscal period not found', 404);
    if (period.status === 'CLOSED') {
      throw new DataError('PERIOD_ALREADY_CLOSED', 'Fiscal period is already closed', 409);
    }
    period.status = 'CLOSED';
    period.closedAt = new Date().toISOString();
    period.closedBy = actor;
    this.fiscalEvents.push({
      eventId: uid(),
      fiscalYearId: period.fiscalYearId,
      periodId: period.periodId,
      action: 'CLOSE_PERIOD',
      reason: null,
      actorUserId: actor,
      createdAt: new Date().toISOString(),
    });
    return this.enrichFiscalPeriod(period);
  }

  async reopenFiscalPeriod(periodId: string, input: ReopenPeriodInput = {}): Promise<FiscalPeriod> {
    await this.wait();
    const actor = this.requireActor();
    const period = this.fiscalPeriods.find((p) => p.periodId === periodId);
    if (!period) throw new DataError('PERIOD_NOT_FOUND', 'Fiscal period not found', 404);
    if (period.status === 'OPEN') {
      throw new DataError('PERIOD_ALREADY_OPEN', 'Fiscal period is already open', 409);
    }
    const year = this.fiscalYearById(period.fiscalYearId);
    if (year.status === 'CLOSED') {
      throw new DataError('FISCAL_YEAR_CLOSED', 'Cannot reopen a period in a closed fiscal year', 409);
    }
    period.status = 'OPEN';
    period.closedAt = null;
    period.closedBy = null;
    this.fiscalEvents.push({
      eventId: uid(),
      fiscalYearId: period.fiscalYearId,
      periodId: period.periodId,
      action: 'REOPEN_PERIOD',
      reason: input.reason ?? null,
      actorUserId: actor,
      createdAt: new Date().toISOString(),
    });
    return this.enrichFiscalPeriod(period);
  }

  async listFiscalEvents(): Promise<FiscalEvent[]> {
    await this.wait();
    return this.fiscalEvents
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((e) => ({
        eventId: e.eventId,
        companyId: seed.company.companyId,
        fiscalYearId: e.fiscalYearId,
        periodId: e.periodId,
        action: e.action,
        reason: e.reason,
        actorUserId: e.actorUserId,
        actorName: this.userName(e.actorUserId),
        createdAt: e.createdAt,
      }));
  }

  async yearEndClose(fiscalYearId: string): Promise<FiscalYear> {
    await this.wait();
    const actor = this.requireActor();
    const year = this.fiscalYearById(fiscalYearId);
    if (year.status === 'CLOSED' || year.closingEntryId) {
      throw new DataError('FISCAL_YEAR_CLOSED', 'Fiscal year is already closed', 409);
    }
    const periods = this.fiscalPeriods.filter((p) => p.fiscalYearId === fiscalYearId);
    const openPeriods = periods.filter((p) => p.status !== 'CLOSED');
    if (openPeriods.length > 0) {
      throw new DataError('PERIODS_NOT_CLOSED', 'Close all periods in the fiscal year before year-end close', 422);
    }
    const retained = this.accountByCode(SYSTEM_ACCOUNT_CODES.retainedEarnings);

    const balances = new Map<string, { accountType: 'REVENUE' | 'EXPENSE'; balance: Decimal }>();
    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      if (entry.entryDate < year.startDate || entry.entryDate > year.endDate) continue;
      if (entry.referenceType === 'YEAR_END_CLOSE') continue;
      for (const line of entry.lines) {
        const account = this.accountById(line.accountId);
        if (account.accountType !== 'REVENUE' && account.accountType !== 'EXPENSE') continue;
        const row = balances.get(account.accountId) ?? {
          accountType: account.accountType,
          balance: new Decimal(0),
        };
        if (row.accountType === 'REVENUE') {
          row.balance = line.entryType === 'CREDIT' ? row.balance.plus(line.amount) : row.balance.minus(line.amount);
        } else {
          row.balance = line.entryType === 'DEBIT' ? row.balance.plus(line.amount) : row.balance.minus(line.amount);
        }
        balances.set(account.accountId, row);
      }
    }

    const closingLines: { accountId: string; entryType: EntryType; amount: number; description: string | null }[] = [];
    let netIncome = new Decimal(0);
    for (const [accountId, row] of balances) {
      if (row.balance.isZero()) continue;
      if (row.accountType === 'REVENUE') {
        closingLines.push({ accountId, entryType: 'DEBIT', amount: moneyToNumber(row.balance), description: 'Year-end close' });
        netIncome = netIncome.plus(row.balance);
      } else {
        closingLines.push({ accountId, entryType: 'CREDIT', amount: moneyToNumber(row.balance), description: 'Year-end close' });
        netIncome = netIncome.minus(row.balance);
      }
    }
    if (!netIncome.isZero() || closingLines.length > 0) {
      if (netIncome.isZero()) {
        throw new DataError('INVALID_CLOSE', 'Closing balances do not produce a net result', 422);
      }
      if (netIncome.greaterThan(0)) {
        closingLines.push({ accountId: retained.accountId, entryType: 'CREDIT', amount: moneyToNumber(netIncome), description: 'Year-end close' });
      } else {
        closingLines.push({ accountId: retained.accountId, entryType: 'DEBIT', amount: moneyToNumber(netIncome.abs()), description: 'Year-end close' });
      }
      const entry = this.createEntry({
        entryDate: year.endDate,
        referenceType: 'YEAR_END_CLOSE',
        referenceId: year.fiscalYearId,
        status: 'POSTED',
        lines: closingLines,
      });
      year.closingEntryId = entry.entryId;
    }

    year.status = 'CLOSED';
    year.closedAt = new Date().toISOString();
    year.closedBy = actor;
    this.fiscalEvents.push({
      eventId: uid(),
      fiscalYearId: year.fiscalYearId,
      periodId: null,
      action: 'YEAR_END_CLOSE',
      reason: year.closingEntryId ? `Closing entry ${year.closingEntryId}` : 'No revenue/expense balances to close',
      actorUserId: actor,
      createdAt: new Date().toISOString(),
    });
    return this.enrichFiscalYear(year);
  }

  // ------------------------------------------------------------ accounts

  async listAccounts(filter: AccountFilter = {}): Promise<Account[]> {
    await this.wait();
    return this.accounts
      .filter((a) => (filter.type ? a.accountType === filter.type : true))
      .filter((a) => (filter.active === undefined ? true : a.isActive === filter.active))
      .filter((a) =>
        filter.search
          ? `${a.accountCode} ${a.accountName}`.toLowerCase().includes(filter.search.toLowerCase())
          : true,
      )
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  private accountById(accountId: string): Account {
    const account = this.accounts.find((a) => a.accountId === accountId);
    if (!account) throw new DataError('ACCOUNT_NOT_FOUND', 'Account not found', 404);
    return account;
  }

  private accountByCode(code: string): Account {
    const account = this.accounts.find((a) => a.accountCode === code);
    if (!account) {
      throw new DataError('ACCOUNT_NOT_CONFIGURED', `System account ${code} is missing`, 500);
    }
    return account;
  }

  async getAccount(accountId: string): Promise<Account> {
    await this.wait();
    return this.accountById(accountId);
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    await this.wait();
    this.requireActor();
    if (this.accounts.some((a) => a.accountCode === input.accountCode)) {
      throw new DataError('DUPLICATE_CODE', `Account code ${input.accountCode} already exists`);
    }
    if (input.parentAccountId) this.accountById(input.parentAccountId);
    const account: Account = {
      accountId: uid(),
      companyId: seed.company.companyId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      accountType: input.accountType,
      parentAccountId: input.parentAccountId ?? null,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
    };
    this.accounts.push(account);
    return account;
  }

  async updateAccount(accountId: string, input: UpdateAccountInput): Promise<Account> {
    await this.wait();
    this.requireActor();
    const account = this.accountById(accountId);
    if (input.accountCode && input.accountCode !== account.accountCode) {
      if (this.accounts.some((a) => a.accountCode === input.accountCode)) {
        throw new DataError('DUPLICATE_CODE', `Account code ${input.accountCode} already exists`);
      }
    }
    if (input.parentAccountId) {
      this.accountById(input.parentAccountId);
      let cursor: string | null = input.parentAccountId;
      while (cursor) {
        if (cursor === accountId) {
          throw new DataError('INVALID_PARENT', 'Parent assignment would create a cycle', 422);
        }
        cursor = this.accounts.find((a) => a.accountId === cursor)?.parentAccountId ?? null;
      }
    }
    if (
      input.accountType &&
      input.accountType !== account.accountType &&
      this.journals.some((j) => j.lines.some((l) => l.accountId === accountId))
    ) {
      throw new DataError(
        'ACCOUNT_TYPE_IN_USE',
        'Cannot change the type of an account that has journal lines',
        409,
      );
    }
    Object.assign(account, {
      accountCode: input.accountCode ?? account.accountCode,
      accountName: input.accountName ?? account.accountName,
      accountType: input.accountType ?? account.accountType,
      parentAccountId:
        input.parentAccountId !== undefined ? input.parentAccountId : account.parentAccountId,
      isActive: input.isActive ?? account.isActive,
    });
    return account;
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.wait();
    this.requireActor();
    this.accountById(accountId);
    if (this.accounts.some((a) => a.parentAccountId === accountId)) {
      throw new DataError('ACCOUNT_IN_USE', 'Account has child accounts');
    }
    if (this.journals.some((j) => j.lines.some((l) => l.accountId === accountId))) {
      throw new DataError('ACCOUNT_IN_USE', 'Account is referenced by journal entries');
    }
    this.accounts = this.accounts.filter((a) => a.accountId !== accountId);
  }

  // ------------------------------------------------------------ journals

  private buildEntry(j: (typeof seed.journals)[number]): JournalEntry {
    const lines: JournalEntryLine[] = j.lines.map((l) => {
      const account = this.accountById(l.accountId);
      return {
        lineId: uid(),
        entryId: j.entryId,
        accountId: l.accountId,
        accountCode: account.accountCode,
        accountName: account.accountName,
        entryType: l.entryType,
        amount: l.amount,
        description: l.description,
      };
    });
    return {
      entryId: j.entryId,
      companyId: seed.company.companyId,
      entryNumber: j.entryNumber,
      entryDate: j.entryDate,
      referenceType: j.referenceType,
      referenceId: j.referenceId,
      status: j.status,
      postedAt: j.postedAt,
      reversedByEntryId: null,
      createdBy: j.createdBy,
      createdByName: this.userName(j.createdBy),
      createdAt: j.createdAt,
      lines,
      ...this.totals(lines),
    };
  }

  private totals(lines: { entryType: EntryType; amount: number }[]): {
    totalDebit: number;
    totalCredit: number;
  } {
    return {
      totalDebit: moneyToNumber(
        sumMoney(lines.filter((line) => line.entryType === 'DEBIT').map((line) => line.amount)),
      ),
      totalCredit: moneyToNumber(
        sumMoney(lines.filter((line) => line.entryType === 'CREDIT').map((line) => line.amount)),
      ),
    };
  }

  private assertLinesWellFormed(lines: NewJournalInput['lines']): void {
    if (lines.length < 2) {
      throw new DataError('INVALID_ENTRY', 'A journal entry needs at least two lines');
    }
    if (lines.some((l) => l.amount <= 0)) {
      throw new DataError('INVALID_ENTRY', 'Every line amount must be greater than zero');
    }
  }

  private assertAccountActive(account: Account): void {
    if (!account.isActive) {
      throw new DataError('ACCOUNT_INACTIVE', `Account ${account.accountCode} is inactive`);
    }
  }

  private assertBalanced(lines: { entryType: EntryType; amount: number }[]): void {
    const totalDebit = sumMoney(
      lines.filter((line) => line.entryType === 'DEBIT').map((line) => line.amount),
    );
    const totalCredit = sumMoney(
      lines.filter((line) => line.entryType === 'CREDIT').map((line) => line.amount),
    );
    if (!totalDebit.equals(totalCredit)) {
      throw new DataError(
        'UNBALANCED_ENTRY',
        `Entry is not balanced: debits ${moneyToNumber(totalDebit)} vs credits ${moneyToNumber(totalCredit)}`,
      );
    }
  }

  private buildLines(entryId: string, input: NewJournalInput['lines']): JournalEntryLine[] {
    return input.map((l) => {
      const account = this.accountById(l.accountId);
      this.assertAccountActive(account);
      return {
        lineId: uid(),
        entryId,
        accountId: l.accountId,
        accountCode: account.accountCode,
        accountName: account.accountName,
        entryType: l.entryType,
        amount: l.amount,
        description: l.description,
      };
    });
  }

  private nextEntryNumber(): string {
    this.journalCounter += 1;
    return `JE-${String(this.journalCounter).padStart(4, '0')}`;
  }

  private createEntry(input: NewJournalInput): JournalEntry {
    this.assertLinesWellFormed(input.lines);
    const entryId = uid();
    const lines = this.buildLines(entryId, input.lines);
    const entry: JournalEntry = {
      entryId,
      companyId: seed.company.companyId,
      entryNumber: this.nextEntryNumber(),
      entryDate: input.entryDate,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      status: input.status,
      postedAt: input.status === 'POSTED' ? new Date().toISOString() : null,
      reversedByEntryId: null,
      createdBy: this.currentUserId ?? seed.users[0].userId,
      createdByName: this.userName(this.currentUserId ?? seed.users[0].userId),
      createdAt: new Date().toISOString(),
      lines,
      ...this.totals(lines),
    };
    this.journals.push(entry);
    return entry;
  }

  async listJournals(filter: JournalFilter = {}): Promise<JournalEntry[]> {
    await this.wait();
    return this.journals
      .filter((j) => (filter.status ? j.status === filter.status : true))
      .filter((j) => (filter.referenceType ? j.referenceType === filter.referenceType : true))
      .filter((j) => (filter.from ? j.entryDate >= filter.from : true))
      .filter((j) => (filter.to ? j.entryDate <= filter.to : true))
      .filter((j) =>
        filter.search
          ? `${j.entryNumber} ${j.referenceType ?? ''}`
              .toLowerCase()
              .includes(filter.search.toLowerCase())
          : true,
      )
      .sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0));
  }

  private journalById(entryId: string): JournalEntry {
    const entry = this.journals.find((j) => j.entryId === entryId);
    if (!entry) throw new DataError('ENTRY_NOT_FOUND', 'Journal entry not found', 404);
    return entry;
  }

  async getJournal(entryId: string): Promise<JournalEntry> {
    await this.wait();
    return this.journalById(entryId);
  }

  async createJournal(input: CreateJournalInput): Promise<JournalEntry> {
    await this.wait();
    this.requireActor();
    this.assertPeriodOpen(input.entryDate);
    return this.createEntry({
      entryDate: input.entryDate,
      referenceType: input.referenceType ?? 'MANUAL',
      referenceId: input.referenceId ?? null,
      status: 'DRAFT',
      lines: input.lines.map((l) => ({
        accountId: l.accountId,
        entryType: l.entryType,
        amount: l.amount,
        description: l.description ?? null,
      })),
    });
  }

  async updateJournal(entryId: string, input: UpdateJournalInput): Promise<JournalEntry> {
    await this.wait();
    this.requireActor();
    const entry = this.journalById(entryId);
    if (entry.status !== 'DRAFT') {
      throw new DataError('ENTRY_NOT_EDITABLE', 'Only draft entries can be edited');
    }
    this.assertPeriodOpen(entry.entryDate);
    if (input.entryDate) {
      this.assertPeriodOpen(input.entryDate);
      entry.entryDate = input.entryDate;
    }
    if (input.referenceType !== undefined) entry.referenceType = input.referenceType;
    if (input.referenceId !== undefined) entry.referenceId = input.referenceId;
    if (input.lines) {
      const lines = input.lines.map((l) => ({
        accountId: l.accountId,
        entryType: l.entryType,
        amount: l.amount,
        description: l.description ?? null,
      }));
      this.assertLinesWellFormed(lines);
      entry.lines = this.buildLines(entry.entryId, lines);
      Object.assign(entry, this.totals(entry.lines));
    }
    return entry;
  }

  async postJournal(entryId: string): Promise<JournalEntry> {
    await this.wait();
    this.requireActor();
    const entry = this.journalById(entryId);
    if (entry.status !== 'DRAFT') {
      throw new DataError('ENTRY_NOT_POSTABLE', 'Only draft entries can be posted');
    }
    this.assertPeriodOpen(entry.entryDate);
    for (const line of entry.lines) this.assertAccountActive(this.accountById(line.accountId));
    this.assertBalanced(entry.lines);
    entry.status = 'POSTED';
    entry.postedAt = new Date().toISOString();
    return entry;
  }

  async voidJournal(entryId: string): Promise<JournalEntry> {
    await this.wait();
    this.requireActor();
    const entry = this.journalById(entryId);
    if (entry.status === 'VOIDED') {
      throw new DataError('ENTRY_ALREADY_VOID', 'Entry is already voided');
    }
    if (entry.reversedByEntryId) {
      throw new DataError('ENTRY_ALREADY_VOID', 'Entry has already been reversed');
    }
    if (entry.status === 'DRAFT') {
      this.assertPeriodOpen(entry.entryDate);
      entry.status = 'VOIDED';
      return entry;
    }

    // Posted entries are never rewritten: post a mirror reversal dated today.
    this.assertPeriodOpen(today());
    const reversal = this.createEntry({
      entryDate: today(),
      referenceType: REVERSAL_REFERENCE_TYPE,
      referenceId: entry.entryId,
      status: 'POSTED',
      lines: entry.lines.map((line) => ({
        accountId: line.accountId,
        entryType: line.entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amount: line.amount,
        description: line.description,
      })),
    });
    entry.reversedByEntryId = reversal.entryId;
    return entry;
  }

  // ------------------------------------------------------------ products

  async listProducts(filter: ProductFilter = {}): Promise<Product[]> {
    await this.wait();
    return this.products
      .filter((p) => (filter.active === undefined ? true : p.isActive === filter.active))
      .filter((p) =>
        filter.search
          ? `${p.sku} ${p.name}`.toLowerCase().includes(filter.search.toLowerCase())
          : true,
      )
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }

  private productById(productId: string): Product {
    const product = this.products.find((p) => p.productId === productId);
    if (!product) throw new DataError('PRODUCT_NOT_FOUND', 'Product not found', 404);
    return product;
  }

  async getProduct(productId: string): Promise<Product> {
    await this.wait();
    return this.productById(productId);
  }

  async createProduct(input: CreateProductInput): Promise<Product> {
    await this.wait();
    this.requireActor();
    if (this.products.some((p) => p.sku === input.sku)) {
      throw new DataError('DUPLICATE_SKU', `SKU ${input.sku} already exists`);
    }
    const product: Product = {
      productId: uid(),
      companyId: seed.company.companyId,
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      unitOfMeasure: input.unitOfMeasure ?? 'PCS',
      reorderThreshold: input.reorderThreshold ?? 10,
      averageCost: 0,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
    };
    this.products.push(product);
    return product;
  }

  async updateProduct(productId: string, input: UpdateProductInput): Promise<Product> {
    await this.wait();
    this.requireActor();
    const product = this.productById(productId);
    if (input.sku && input.sku !== product.sku) {
      if (this.products.some((p) => p.sku === input.sku)) {
        throw new DataError('DUPLICATE_SKU', `SKU ${input.sku} already exists`);
      }
    }
    Object.assign(product, {
      sku: input.sku ?? product.sku,
      name: input.name ?? product.name,
      description: input.description ?? product.description,
      unitOfMeasure: input.unitOfMeasure ?? product.unitOfMeasure,
      reorderThreshold: input.reorderThreshold ?? product.reorderThreshold,
      isActive: input.isActive ?? product.isActive,
    });
    return product;
  }

  async removeProduct(productId: string): Promise<void> {
    await this.wait();
    this.requireActor();
    this.productById(productId);
    if (this.stock.some((s) => s.productId === productId && s.quantityOnHand > 0)) {
      throw new DataError('PRODUCT_IN_USE', 'Product still has stock on hand');
    }
    if (this.movements.some((m) => m.productId === productId)) {
      throw new DataError('PRODUCT_IN_USE', 'Product has inventory history');
    }
    this.products = this.products.filter((p) => p.productId !== productId);
  }

  // ---------------------------------------------------------- warehouses

  async listWarehouses(filter: WarehouseFilter = {}): Promise<Warehouse[]> {
    await this.wait();
    return this.warehouses
      .filter((w) => (filter.active === undefined ? true : w.isActive === filter.active))
      .filter((w) =>
        filter.search
          ? `${w.code} ${w.name}`.toLowerCase().includes(filter.search.toLowerCase())
          : true,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  private warehouseById(warehouseId: string): Warehouse {
    const warehouse = this.warehouses.find((w) => w.warehouseId === warehouseId);
    if (!warehouse) throw new DataError('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404);
    return warehouse;
  }

  async getWarehouse(warehouseId: string): Promise<Warehouse> {
    await this.wait();
    return this.warehouseById(warehouseId);
  }

  async createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
    await this.wait();
    this.requireActor();
    if (this.warehouses.some((w) => w.code === input.code)) {
      throw new DataError('DUPLICATE_CODE', `Warehouse code ${input.code} already exists`);
    }
    const warehouse: Warehouse = {
      warehouseId: uid(),
      companyId: seed.company.companyId,
      code: input.code,
      name: input.name,
      locationAddress: input.locationAddress ?? null,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
    };
    this.warehouses.push(warehouse);
    return warehouse;
  }

  async updateWarehouse(warehouseId: string, input: UpdateWarehouseInput): Promise<Warehouse> {
    await this.wait();
    this.requireActor();
    const warehouse = this.warehouseById(warehouseId);
    if (input.code && input.code !== warehouse.code) {
      if (this.warehouses.some((w) => w.code === input.code)) {
        throw new DataError('DUPLICATE_CODE', `Warehouse code ${input.code} already exists`);
      }
    }
    Object.assign(warehouse, {
      code: input.code ?? warehouse.code,
      name: input.name ?? warehouse.name,
      locationAddress: input.locationAddress ?? warehouse.locationAddress,
      isActive: input.isActive ?? warehouse.isActive,
    });
    return warehouse;
  }

  async removeWarehouse(warehouseId: string): Promise<void> {
    await this.wait();
    this.requireActor();
    this.warehouseById(warehouseId);
    if (this.stock.some((s) => s.warehouseId === warehouseId && s.quantityOnHand > 0)) {
      throw new DataError('WAREHOUSE_IN_USE', 'Warehouse still holds stock');
    }
    if (this.movements.some((m) => m.warehouseId === warehouseId)) {
      throw new DataError('WAREHOUSE_IN_USE', 'Warehouse has inventory history');
    }
    this.warehouses = this.warehouses.filter((w) => w.warehouseId !== warehouseId);
  }

  // ----------------------------------------------------------- inventory

  private enrichStock(row: StockRow): InventoryStock {
    const product = this.productById(row.productId);
    const warehouse = this.warehouseById(row.warehouseId);
    return {
      stockId: row.stockId,
      productId: row.productId,
      warehouseId: row.warehouseId,
      sku: product.sku,
      productName: product.name,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      quantityOnHand: row.quantityOnHand,
      quantityReserved: row.quantityReserved,
      reorderThreshold: product.reorderThreshold,
      isLowStock: row.quantityOnHand <= product.reorderThreshold,
      updatedAt: row.updatedAt,
    };
  }

  private enrichMovement(row: MovementRow): InventoryTransaction {
    const product = this.productById(row.productId);
    const warehouse = this.warehouseById(row.warehouseId);
    return {
      transactionId: row.transactionId,
      productId: row.productId,
      warehouseId: row.warehouseId,
      sku: product.sku,
      productName: product.name,
      warehouseCode: warehouse.code,
      movementType: row.movementType,
      quantity: row.quantity,
      unitCost: row.unitCost,
      referenceId: row.referenceId,
      createdBy: row.createdBy,
      createdByName: this.userName(row.createdBy),
      createdAt: row.createdAt,
    };
  }

  private findStock(productId: string, warehouseId: string): StockRow | undefined {
    return this.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  }

  private upsertStock(productId: string, warehouseId: string): StockRow {
    let row = this.findStock(productId, warehouseId);
    if (!row) {
      row = {
        stockId: uid(),
        productId,
        warehouseId,
        quantityOnHand: 0,
        quantityReserved: 0,
        updatedAt: new Date().toISOString(),
      };
      this.stock.push(row);
    }
    return row;
  }

  private addMovement(
    productId: string,
    warehouseId: string,
    movementType: MovementType,
    quantity: number,
    unitCost: number,
    referenceId: string | null,
  ): MovementRow {
    const row: MovementRow = {
      transactionId: uid(),
      productId,
      warehouseId,
      movementType,
      quantity,
      unitCost,
      referenceId,
      createdBy: this.currentUserId ?? seed.users[0].userId,
      createdAt: new Date().toISOString(),
    };
    this.movements.push(row);
    return row;
  }

  private inventoryEntry(
    referenceType: string,
    referenceId: string,
    debitAccountId: string,
    creditAccountId: string,
    amount: number,
    description: string,
  ): JournalEntry {
    return this.createEntry({
      entryDate: today(),
      referenceType,
      referenceId,
      status: 'POSTED',
      lines: [
        { accountId: debitAccountId, entryType: 'DEBIT', amount, description },
        { accountId: creditAccountId, entryType: 'CREDIT', amount, description },
      ],
    });
  }

  async listStock(filter: StockFilter = {}): Promise<InventoryStock[]> {
    await this.wait();
    return this.stock
      .map((row) => this.enrichStock(row))
      .filter((s) => (filter.productId ? s.productId === filter.productId : true))
      .filter((s) => (filter.warehouseId ? s.warehouseId === filter.warehouseId : true))
      .filter((s) => (filter.lowStock ? s.isLowStock : true))
      .filter((s) =>
        filter.search
          ? `${s.sku} ${s.productName}`.toLowerCase().includes(filter.search.toLowerCase())
          : true,
      )
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }

  async listMovements(filter: MovementFilter = {}): Promise<InventoryTransaction[]> {
    await this.wait();
    return this.movements
      .map((row) => this.enrichMovement(row))
      .filter((m) => (filter.productId ? m.productId === filter.productId : true))
      .filter((m) => (filter.warehouseId ? m.warehouseId === filter.warehouseId : true))
      .filter((m) => (filter.movementType ? m.movementType === filter.movementType : true))
      .filter((m) => (filter.from ? m.createdAt >= filter.from : true))
      .filter((m) => (filter.to ? m.createdAt <= filter.to : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async receipt(input: ReceiptInput): Promise<InventoryTransaction> {
    await this.wait();
    this.requireActor();
    this.assertPeriodOpen(today());
    const product = this.productById(input.productId);
    this.warehouseById(input.warehouseId);

    const row = this.upsertStock(input.productId, input.warehouseId);
    const totalQty = this.stock
      .filter((s) => s.productId === input.productId)
      .reduce((sum, s) => sum + s.quantityOnHand, 0);
    product.averageCost = moneyToNumber(
      money(totalQty)
        .times(product.averageCost)
        .plus(money(input.quantity).times(input.unitCost))
        .dividedBy(totalQty + input.quantity),
    );
    row.quantityOnHand += input.quantity;
    row.updatedAt = new Date().toISOString();

    const movement = this.addMovement(
      input.productId,
      input.warehouseId,
      'GOODS_RECEIPT',
      signedMovementQuantity('GOODS_RECEIPT', input.quantity),
      input.unitCost,
      input.referenceId ?? null,
    );

    const amount = moneyToNumber(money(input.quantity).times(input.unitCost));
    if (amount !== 0) {
      this.inventoryEntry(
        'INVENTORY_RECEIPT',
        movement.transactionId,
        this.accountByCode(SYSTEM_ACCOUNT_CODES.inventory).accountId,
        this.accountByCode(SYSTEM_ACCOUNT_CODES.accountsPayable).accountId,
        amount,
        `Goods receipt - ${product.sku}`,
      );
    }

    return this.enrichMovement(movement);
  }

  async issue(input: IssueInput): Promise<InventoryTransaction> {
    await this.wait();
    this.requireActor();
    this.assertPeriodOpen(today());
    const product = this.productById(input.productId);
    this.warehouseById(input.warehouseId);

    const row = this.findStock(input.productId, input.warehouseId);
    const available = row ? row.quantityOnHand : 0;
    if (available < input.quantity) {
      throw new DataError(
        'INSUFFICIENT_STOCK',
        `Only ${available} units of ${product.sku} available in this warehouse`,
      );
    }

    const unitCost = product.averageCost;
    row!.quantityOnHand -= input.quantity;
    row!.updatedAt = new Date().toISOString();

    const movement = this.addMovement(
      input.productId,
      input.warehouseId,
      'SALES_ISSUE',
      signedMovementQuantity('SALES_ISSUE', input.quantity),
      unitCost,
      input.referenceId ?? null,
    );

    const amount = moneyToNumber(money(input.quantity).times(unitCost));
    if (amount !== 0) {
      this.inventoryEntry(
        'SALES_ISSUE',
        movement.transactionId,
        this.accountByCode(SYSTEM_ACCOUNT_CODES.costOfGoodsSold).accountId,
        this.accountByCode(SYSTEM_ACCOUNT_CODES.inventory).accountId,
        amount,
        `Sales issue - ${product.sku}`,
      );
    }

    return this.enrichMovement(movement);
  }

  async transfer(input: TransferInput): Promise<InventoryTransaction[]> {
    await this.wait();
    this.requireActor();
    this.assertPeriodOpen(today());
    const product = this.productById(input.productId);
    this.warehouseById(input.fromWarehouseId);
    this.warehouseById(input.toWarehouseId);

    const from = this.findStock(input.productId, input.fromWarehouseId);
    const available = from ? from.quantityOnHand : 0;
    if (available < input.quantity) {
      throw new DataError(
        'INSUFFICIENT_STOCK',
        `Only ${available} units of ${product.sku} available to transfer`,
      );
    }

    const unitCost = product.averageCost;
    from!.quantityOnHand -= input.quantity;
    from!.updatedAt = new Date().toISOString();
    const to = this.upsertStock(input.productId, input.toWarehouseId);
    to.quantityOnHand += input.quantity;
    to.updatedAt = new Date().toISOString();

    const out = this.addMovement(
      input.productId,
      input.fromWarehouseId,
      'TRANSFER_OUT',
      signedMovementQuantity('TRANSFER_OUT', input.quantity),
      unitCost,
      null,
    );
    const into = this.addMovement(
      input.productId,
      input.toWarehouseId,
      'TRANSFER_IN',
      signedMovementQuantity('TRANSFER_IN', input.quantity),
      unitCost,
      null,
    );
    return [this.enrichMovement(out), this.enrichMovement(into)];
  }

  async adjust(input: AdjustmentInput): Promise<InventoryTransaction> {
    await this.wait();
    this.requireActor();
    this.assertPeriodOpen(today());
    const product = this.productById(input.productId);
    this.warehouseById(input.warehouseId);

    const row = this.upsertStock(input.productId, input.warehouseId);
    const next = row.quantityOnHand + input.quantityDelta;
    if (next < 0) {
      throw new DataError(
        'INSUFFICIENT_STOCK',
        `Adjustment would make ${product.sku} stock negative`,
      );
    }
    row.quantityOnHand = next;
    row.updatedAt = new Date().toISOString();

    const movement = this.addMovement(
      input.productId,
      input.warehouseId,
      'ADJUSTMENT',
      input.quantityDelta,
      product.averageCost,
      null,
    );
    // A write-off expenses the lost value; a gain brings it back. Zero-value
    // adjustments post nothing, matching the API (WORKFLOWS.md §10).
    const amount = moneyToNumber(money(Math.abs(input.quantityDelta)).times(product.averageCost));
    if (amount !== 0) {
      const writeOff = input.quantityDelta < 0;
      this.inventoryEntry(
        'ADJUSTMENT',
        movement.transactionId,
        this.accountByCode(
          writeOff ? SYSTEM_ACCOUNT_CODES.operatingExpenses : SYSTEM_ACCOUNT_CODES.inventory,
        ).accountId,
        this.accountByCode(
          writeOff ? SYSTEM_ACCOUNT_CODES.inventory : SYSTEM_ACCOUNT_CODES.operatingExpenses,
        ).accountId,
        amount,
        `Stock adjustment - ${product.sku}`,
      );
    }
    return this.enrichMovement(movement);
  }

  // ----------------------------------------------------------- stocktakes

  private enrichStocktake(row: StocktakeRow): Stocktake {
    const warehouse = this.warehouseById(row.warehouseId);
    return {
      stocktakeId: row.stocktakeId,
      warehouseId: row.warehouseId,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      status: row.status,
      notes: row.notes,
      createdBy: row.createdBy,
      createdByName: this.userName(row.createdBy),
      appliedBy: row.appliedBy,
      appliedByName: row.appliedBy ? this.userName(row.appliedBy) : null,
      appliedAt: row.appliedAt,
      createdAt: row.createdAt,
      lines: row.lines
        .map((line) => {
          const product = this.productById(line.productId);
          return {
            lineId: line.lineId,
            productId: line.productId,
            sku: product.sku,
            productName: product.name,
            systemQuantity: line.systemQuantity,
            countedQuantity: line.countedQuantity,
            variance: line.variance,
          } satisfies StocktakeLine;
        })
        .sort((a, b) => a.sku.localeCompare(b.sku)),
    };
  }

  async listStocktakes(warehouseId?: string): Promise<Stocktake[]> {
    await this.wait();
    return this.stocktakes
      .filter((s) => (warehouseId ? s.warehouseId === warehouseId : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((s) => this.enrichStocktake(s));
  }

  async getStocktake(stocktakeId: string): Promise<Stocktake> {
    await this.wait();
    const row = this.stocktakes.find((s) => s.stocktakeId === stocktakeId);
    if (!row) throw new DataError('STOCKTAKE_NOT_FOUND', 'Stocktake not found', 404);
    return this.enrichStocktake(row);
  }

  async createStocktake(input: CreateStocktakeInput): Promise<Stocktake> {
    await this.wait();
    const actor = this.requireActor();
    this.warehouseById(input.warehouseId);

    const seen = new Set<string>();
    for (const line of input.lines) {
      if (seen.has(line.productId)) {
        throw new DataError('DUPLICATE_PRODUCT', 'Each product can appear once per count sheet', 422);
      }
      seen.add(line.productId);
      this.productById(line.productId);
    }

    const row: StocktakeRow = {
      stocktakeId: uid(),
      warehouseId: input.warehouseId,
      status: 'DRAFT',
      notes: input.notes ?? null,
      createdBy: actor,
      appliedBy: null,
      appliedAt: null,
      createdAt: new Date().toISOString(),
      lines: input.lines.map((line) => {
        const systemQuantity = this.findStock(line.productId, input.warehouseId)?.quantityOnHand ?? 0;
        return {
          lineId: uid(),
          productId: line.productId,
          systemQuantity,
          countedQuantity: line.countedQuantity,
          variance: line.countedQuantity - systemQuantity,
        };
      }),
    };
    this.stocktakes.push(row);
    return this.enrichStocktake(row);
  }

  async applyStocktake(stocktakeId: string): Promise<Stocktake> {
    await this.wait();
    const actor = this.requireActor();
    this.assertPeriodOpen(today());
    const row = this.stocktakes.find((s) => s.stocktakeId === stocktakeId);
    if (!row) throw new DataError('STOCKTAKE_NOT_FOUND', 'Stocktake not found', 404);
    if (row.status !== 'DRAFT') {
      throw new DataError('STOCKTAKE_NOT_DRAFT', 'Only draft stocktakes can be applied', 409);
    }

    for (const line of row.lines) {
      if (line.variance === 0) continue;
      const product = this.productById(line.productId);
      const stock = this.upsertStock(line.productId, row.warehouseId);
      const next = stock.quantityOnHand + line.variance;
      if (next < 0) {
        throw new DataError(
          'INSUFFICIENT_STOCK',
          `Applying count would make ${product.sku} stock negative`,
          422,
        );
      }
      stock.quantityOnHand = next;
      stock.updatedAt = new Date().toISOString();

      const movement = this.addMovement(
        line.productId,
        row.warehouseId,
        'ADJUSTMENT',
        line.variance,
        product.averageCost,
        row.stocktakeId,
      );
      const amount = moneyToNumber(money(Math.abs(line.variance)).times(product.averageCost));
      if (amount !== 0) {
        const writeOff = line.variance < 0;
        this.inventoryEntry(
          'ADJUSTMENT',
          movement.transactionId,
          this.accountByCode(
            writeOff ? SYSTEM_ACCOUNT_CODES.operatingExpenses : SYSTEM_ACCOUNT_CODES.inventory,
          ).accountId,
          this.accountByCode(
            writeOff ? SYSTEM_ACCOUNT_CODES.inventory : SYSTEM_ACCOUNT_CODES.operatingExpenses,
          ).accountId,
          amount,
          `Stocktake adjustment - ${product.sku}`,
        );
      }
    }

    row.status = 'APPLIED';
    row.appliedBy = actor;
    row.appliedAt = new Date().toISOString();
    return this.enrichStocktake(row);
  }

  // ------------------------------------------------------------- reports

  async trialBalance(filter: TrialBalanceFilter): Promise<TrialBalanceRow[]> {
    await this.wait();
    const rows = new Map<
      string,
      {
        accountId: string;
        accountCode: string;
        accountName: string;
        accountType: TrialBalanceRow['accountType'];
        debit: Decimal;
        credit: Decimal;
      }
    >();
    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      if (entry.entryDate < filter.from || entry.entryDate > filter.to) continue;
      for (const line of entry.lines) {
        let row = rows.get(line.accountId);
        if (!row) {
          const account = this.accountById(line.accountId);
          row = {
            accountId: account.accountId,
            accountCode: account.accountCode,
            accountName: account.accountName,
            accountType: account.accountType,
            debit: new Decimal(0),
            credit: new Decimal(0),
          };
          rows.set(line.accountId, row);
        }
        if (line.entryType === 'DEBIT') row.debit = row.debit.plus(line.amount);
        else row.credit = row.credit.plus(line.amount);
      }
    }
    return [...rows.values()]
      .map((r) => ({
        ...r,
        debit: moneyToNumber(r.debit),
        credit: moneyToNumber(r.credit),
        net: moneyToNumber(r.debit.minus(r.credit)),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  async accountLedger(accountId: string, filter: AccountLedgerFilter): Promise<AccountLedgerReport> {
    await this.wait();
    const account = this.accountById(accountId);
    const items: Array<{
      lineId: string;
      entryId: string;
      entryNumber: string;
      entryDate: string;
      referenceType: string | null;
      referenceId: string | null;
      description: string | null;
      entryType: 'DEBIT' | 'CREDIT';
      amount: number;
      sortKey: string;
    }> = [];

    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      if (entry.entryDate > filter.to) continue;
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        items.push({
          lineId: line.lineId,
          entryId: entry.entryId,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          referenceType: entry.referenceType ?? null,
          referenceId: entry.referenceId ?? null,
          description: line.description ?? null,
          entryType: line.entryType,
          amount: line.amount,
          sortKey: `${entry.entryDate}|${entry.entryNumber}|${line.lineId}`,
        });
      }
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let opening = new Decimal(0);
    let running = new Decimal(0);
    const periodLines: AccountLedgerReport['lines'] = [];
    for (const item of items) {
      const delta = item.entryType === 'DEBIT' ? money(item.amount) : money(item.amount).negated();
      if (item.entryDate < filter.from) {
        opening = opening.plus(delta);
        running = running.plus(delta);
        continue;
      }
      running = running.plus(delta);
      periodLines.push({
        lineId: item.lineId,
        entryId: item.entryId,
        entryNumber: item.entryNumber,
        entryDate: item.entryDate,
        referenceType: item.referenceType,
        referenceId: item.referenceId,
        description: item.description,
        entryType: item.entryType,
        debit: item.entryType === 'DEBIT' ? item.amount : 0,
        credit: item.entryType === 'CREDIT' ? item.amount : 0,
        runningBalance: moneyToNumber(running),
      });
    }

    return {
      accountId: account.accountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      from: filter.from,
      to: filter.to,
      openingBalance: moneyToNumber(opening),
      closingBalance: moneyToNumber(running),
      lines: periodLines,
    };
  }

  private inventoryAccountBalance(): number {
    const inventoryAccountId = this.accountByCode(SYSTEM_ACCOUNT_CODES.inventory).accountId;
    let net = new Decimal(0);
    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      for (const line of entry.lines) {
        if (line.accountId !== inventoryAccountId) continue;
        net = line.entryType === 'DEBIT' ? net.plus(line.amount) : net.minus(line.amount);
      }
    }
    return moneyToNumber(net);
  }

  async inventoryValuation(): Promise<InventoryValuationReport> {
    await this.wait();
    const rows = this.stock
      .filter((row) => row.quantityOnHand !== 0)
      .map((row) => {
        const product = this.productById(row.productId);
        const warehouse = this.warehouseById(row.warehouseId);
        const value = moneyToNumber(money(row.quantityOnHand).times(product.averageCost));
        return {
          productId: row.productId,
          warehouseId: row.warehouseId,
          sku: product.sku,
          productName: product.name,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          quantityOnHand: row.quantityOnHand,
          averageCost: product.averageCost,
          value,
        };
      })
      .sort(
        (a, b) => a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode),
      );
    const totalValue = moneyToNumber(sumMoney(rows.map((row) => row.value)));
    const inventoryAccountBalance = this.inventoryAccountBalance();
    return {
      rows,
      totalValue,
      inventoryAccountBalance,
      difference: moneyToNumber(money(totalValue).minus(inventoryAccountBalance)),
    };
  }

  async inventoryMovementSummary(
    filter: InventoryMovementSummaryFilter,
  ): Promise<InventoryMovementSummaryReport> {
    await this.wait();
    const groups = new Map<
      string,
      {
        period: string;
        movementType: MovementType;
        movementCount: number;
        quantityIn: Decimal;
        quantityOut: Decimal;
        totalValue: Decimal;
      }
    >();

    for (const m of this.movements) {
      const date = m.createdAt.slice(0, 10);
      if (date < filter.from || date > filter.to) continue;
      const period = m.createdAt.slice(0, 7);
      const key = `${period}|${m.movementType}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          period,
          movementType: m.movementType,
          movementCount: 0,
          quantityIn: new Decimal(0),
          quantityOut: new Decimal(0),
          totalValue: new Decimal(0),
        };
        groups.set(key, row);
      }
      row.movementCount += 1;
      const qty = Math.abs(m.quantity);
      row.totalValue = row.totalValue.plus(money(qty).times(m.unitCost));
      if (m.quantity >= 0) row.quantityIn = row.quantityIn.plus(qty);
      else row.quantityOut = row.quantityOut.plus(qty);
    }

    const rows = [...groups.values()]
      .map((r) => ({
        period: r.period,
        movementType: r.movementType,
        movementCount: r.movementCount,
        quantityIn: moneyToNumber(r.quantityIn),
        quantityOut: moneyToNumber(r.quantityOut),
        totalValue: moneyToNumber(r.totalValue),
      }))
      .sort(
        (a, b) => a.period.localeCompare(b.period) || a.movementType.localeCompare(b.movementType),
      );
    return { rows };
  }

  async profitAndLoss(filter: FinancialStatementFilter): Promise<ProfitAndLossReport> {
    await this.wait();
    const revenueMap = new Map<string, { accountId: string; accountCode: string; accountName: string; amount: Decimal }>();
    const expenseMap = new Map<string, { accountId: string; accountCode: string; accountName: string; amount: Decimal }>();

    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      if (entry.referenceType === 'YEAR_END_CLOSE') continue;
      if (entry.entryDate < filter.from || entry.entryDate > filter.to) continue;
      for (const line of entry.lines) {
        const account = this.accountById(line.accountId);
        if (account.accountType !== 'REVENUE' && account.accountType !== 'EXPENSE') continue;
        const map = account.accountType === 'REVENUE' ? revenueMap : expenseMap;
        const row = map.get(account.accountId) ?? {
          accountId: account.accountId,
          accountCode: account.accountCode,
          accountName: account.accountName,
          amount: new Decimal(0),
        };
        if (account.accountType === 'REVENUE') {
          row.amount = line.entryType === 'CREDIT' ? row.amount.plus(line.amount) : row.amount.minus(line.amount);
        } else {
          row.amount = line.entryType === 'DEBIT' ? row.amount.plus(line.amount) : row.amount.minus(line.amount);
        }
        map.set(account.accountId, row);
      }
    }

    const toRows = (map: typeof revenueMap) =>
      [...map.values()]
        .map((r) => ({ accountId: r.accountId, accountCode: r.accountCode, accountName: r.accountName, amount: moneyToNumber(r.amount) }))
        .filter((r) => r.amount !== 0)
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const revenue = toRows(revenueMap);
    const expenses = toRows(expenseMap);
    const totalRevenue = moneyToNumber(sumMoney(revenue.map((r) => r.amount)));
    const totalExpenses = moneyToNumber(sumMoney(expenses.map((r) => r.amount)));
    return {
      from: filter.from,
      to: filter.to,
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome: moneyToNumber(money(totalRevenue).minus(totalExpenses)),
    };
  }

  async balanceSheet(filter: BalanceSheetFilter): Promise<BalanceSheetReport> {
    await this.wait();
    const byAccount = new Map<string, { accountId: string; accountCode: string; accountName: string; accountType: string; debit: Decimal; credit: Decimal }>();
    for (const entry of this.journals) {
      if (entry.status !== 'POSTED') continue;
      if (entry.entryDate > filter.asOf) continue;
      for (const line of entry.lines) {
        const account = this.accountById(line.accountId);
        const row = byAccount.get(account.accountId) ?? {
          accountId: account.accountId,
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: account.accountType,
          debit: new Decimal(0),
          credit: new Decimal(0),
        };
        if (line.entryType === 'DEBIT') row.debit = row.debit.plus(line.amount);
        else row.credit = row.credit.plus(line.amount);
        byAccount.set(account.accountId, row);
      }
    }

    const sectionRows = (types: string[], creditNormal: boolean) =>
      [...byAccount.values()]
        .filter((a) => types.includes(a.accountType))
        .map((a) => ({
          accountId: a.accountId,
          accountCode: a.accountCode,
          accountName: a.accountName,
          amount: moneyToNumber(creditNormal ? a.credit.minus(a.debit) : a.debit.minus(a.credit)),
        }))
        .filter((r) => r.amount !== 0)
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const assets = sectionRows(['ASSET'], false);
    const liabilities = sectionRows(['LIABILITY'], true);
    const equityAccounts = sectionRows(['EQUITY'], true);

    let revenueNet = new Decimal(0);
    let expenseNet = new Decimal(0);
    for (const a of byAccount.values()) {
      if (a.accountType === 'REVENUE') revenueNet = revenueNet.plus(a.credit.minus(a.debit));
      if (a.accountType === 'EXPENSE') expenseNet = expenseNet.plus(a.debit.minus(a.credit));
    }
    const currentEarnings = moneyToNumber(revenueNet.minus(expenseNet));
    const equityLines = currentEarnings !== 0
      ? [...equityAccounts, { accountId: 'current-earnings', accountCode: '', accountName: 'Current Year Earnings', amount: currentEarnings }]
          .sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.accountName.localeCompare(b.accountName))
      : equityAccounts;

    const totalAssets = moneyToNumber(sumMoney(assets.map((r) => r.amount)));
    const totalLiabilities = moneyToNumber(sumMoney(liabilities.map((r) => r.amount)));
    const totalEquity = moneyToNumber(sumMoney(equityLines.map((r) => r.amount)));
    const totalLiabilitiesAndEquity = moneyToNumber(money(totalLiabilities).plus(totalEquity));
    const difference = moneyToNumber(money(totalAssets).minus(totalLiabilitiesAndEquity));
    return {
      asOf: filter.asOf,
      assets: { lines: assets, total: totalAssets },
      liabilities: { lines: liabilities, total: totalLiabilities },
      equity: { lines: equityLines, total: totalEquity },
      totalLiabilitiesAndEquity,
      balanced: difference === 0,
      difference,
    };
  }

  async cashFlow(filter: FinancialStatementFilter): Promise<CashFlowStatementReport> {
    await this.wait();
    const root1000 = this.accounts.find((a) => a.accountCode === '1000');
    const cashIds = new Set<string>();
    if (root1000) {
      cashIds.add(root1000.accountId);
      for (const a of this.accounts) {
        if (a.parentAccountId === root1000.accountId) cashIds.add(a.accountId);
      }
    } else {
      for (const a of this.accounts) if (a.accountCode === '1010') cashIds.add(a.accountId);
    }

    let openingCash = new Decimal(0);
    const operating: { label: string; amount: number; referenceType?: string | null }[] = [];
    const investing: { label: string; amount: number; referenceType?: string | null }[] = [];
    const financing: { label: string; amount: number; referenceType?: string | null }[] = [];

    const classify = (lines: { accountId: string }[]): 'operating' | 'investing' | 'financing' => {
      const nonCash = lines
        .filter((l) => !cashIds.has(l.accountId))
        .map((l) => this.accountById(l.accountId));
      if (nonCash.some((a) => a.accountType === 'EQUITY')) return 'financing';
      if (nonCash.some((a) => a.accountType === 'REVENUE' || a.accountType === 'EXPENSE' || a.accountType === 'LIABILITY')) return 'operating';
      if (nonCash.some((a) => a.accountType === 'ASSET')) return 'operating';
      return 'investing';
    };

    const entries = this.journals
      .filter((e) => e.status === 'POSTED' && e.entryDate <= filter.to)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryNumber.localeCompare(b.entryNumber));

    for (const entry of entries) {
      let cashDelta = new Decimal(0);
      for (const line of entry.lines) {
        if (!cashIds.has(line.accountId)) continue;
        cashDelta = line.entryType === 'DEBIT' ? cashDelta.plus(line.amount) : cashDelta.minus(line.amount);
      }
      if (cashDelta.isZero()) continue;
      if (entry.entryDate < filter.from) {
        openingCash = openingCash.plus(cashDelta);
        continue;
      }
      const bucket = classify(entry.lines);
      const item = { label: entry.referenceType ?? 'Journal entry', amount: moneyToNumber(cashDelta), referenceType: entry.referenceType ?? null };
      if (bucket === 'operating') operating.push(item);
      else if (bucket === 'financing') financing.push(item);
      else investing.push(item);
    }

    const sumItems = (items: { amount: number }[]) => moneyToNumber(sumMoney(items.map((i) => i.amount)));
    const operatingTotal = sumItems(operating);
    const investingTotal = sumItems(investing);
    const financingTotal = sumItems(financing);
    const netChange = moneyToNumber(money(operatingTotal).plus(investingTotal).plus(financingTotal));
    const closingCash = moneyToNumber(openingCash.plus(netChange));
    return {
      from: filter.from,
      to: filter.to,
      openingCash: moneyToNumber(openingCash),
      closingCash,
      netChange,
      operating: { lines: operating, total: operatingTotal },
      investing: { lines: investing, total: investingTotal },
      financing: { lines: financing, total: financingTotal },
    };
  }

  async inventoryAging(filter: InventoryAgingFilter = {}): Promise<InventoryAgingReport> {
    await this.wait();
    const asOf = filter.asOf ?? today();
    const asOfTime = new Date(`${asOf}T23:59:59.999Z`).getTime();
    const lastByKey = new Map<string, string>();
    for (const m of this.movements) {
      const key = `${m.productId}|${m.warehouseId}`;
      const prev = lastByKey.get(key);
      if (!prev || m.createdAt > prev) lastByKey.set(key, m.createdAt);
    }

    const rows = this.stock
      .filter((row) => row.quantityOnHand > 0)
      .map((row) => {
        const product = this.productById(row.productId);
        const warehouse = this.warehouseById(row.warehouseId);
        const last = lastByKey.get(`${row.productId}|${row.warehouseId}`) ?? null;
        const daysSinceLastMovement =
          last === null
            ? null
            : Math.max(0, Math.floor((asOfTime - new Date(last).getTime()) / 86_400_000));
        return {
          productId: row.productId,
          warehouseId: row.warehouseId,
          sku: product.sku,
          productName: product.name,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          quantityOnHand: row.quantityOnHand,
          averageCost: product.averageCost,
          value: moneyToNumber(money(row.quantityOnHand).times(product.averageCost)),
          lastMovementAt: last,
          daysSinceLastMovement,
        };
      })
      .sort((a, b) => {
        const da = a.daysSinceLastMovement ?? -1;
        const db = b.daysSinceLastMovement ?? -1;
        return db - da || a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode);
      });
    return { asOf, rows };
  }

  async dashboard(): Promise<DashboardStats> {
    await this.wait();
    const lowStock = (await this.listStock({ lowStock: true })).slice(0, 5);
    const recentJournals = [...this.journals]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5);
    return {
      accountsCount: this.accounts.length,
      productsCount: this.products.length,
      warehousesCount: this.warehouses.length,
      journalsCount: this.journals.length,
      draftJournals: this.journals.filter((j) => j.status === 'DRAFT').length,
      postedJournals: this.journals.filter((j) => j.status === 'POSTED').length,
      lowStockCount: this.stock.filter((s) => this.enrichStock(s).isLowStock).length,
      totalStockUnits: this.stock.reduce((sum, s) => sum + s.quantityOnHand, 0),
      recentJournals,
      lowStock,
    };
  }
}
