import {
  seed,
  seedCreatedAt,
  type Account,
  type AccountFilter,
  type AdjustmentInput,
  type AuthUser,
  type CreateAccountInput,
  type CreateJournalInput,
  type CreateProductInput,
  type CreateWarehouseInput,
  type DashboardStats,
  type EntryType,
  type InventoryStock,
  type InventoryTransaction,
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
  type ReceiptInput,
  type StockFilter,
  type TransferInput,
  type TrialBalanceFilter,
  type TrialBalanceRow,
  type UpdateAccountInput,
  type UpdateJournalInput,
  type UpdateProductInput,
  type UpdateWarehouseInput,
  type Warehouse,
  type WarehouseFilter,
  SYSTEM_ACCOUNT_CODES,
} from '@erp/shared';
import { DataError } from '../errors';

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

const uid = (): string => globalThis.crypto.randomUUID();
const today = (): string => new Date().toISOString().slice(0, 10);
const round = (n: number): number => Math.round(n * 10000) / 10000;

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

  private currentUserId: string | null = seed.users[0].userId;
  private journalCounter = seed.journals.length;

  constructor(options: { latency?: number } = {}) {
    this.latency = options.latency ?? 0;

    this.accounts = seed.accounts.map((a) => ({
      ...a,
      isActive: true,
      createdAt: seedCreatedAt,
    }));
    this.products = seed.products.map((p) => ({
      ...p,
      isActive: true,
      createdAt: seedCreatedAt,
    }));
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
  }

  private async wait(): Promise<void> {
    if (this.latency > 0) await sleep(this.latency);
  }

  // ---------------------------------------------------------------- auth

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

  async login(input: LoginInput): Promise<LoginResponse> {
    await this.wait();
    const user = seed.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
    if (!user || user.password !== input.password) {
      throw new DataError('INVALID_CREDENTIALS', 'Incorrect email or password', 401);
    }
    this.currentUserId = user.userId;
    return {
      accessToken: `mock-access.${user.userId}`,
      refreshToken: `mock-refresh.${user.userId}`,
      user: this.authUser(user.userId),
    };
  }

  async logout(): Promise<void> {
    await this.wait();
    this.currentUserId = null;
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
    if (input.parentAccountId === accountId) {
      throw new DataError('INVALID_PARENT', 'An account cannot be its own parent');
    }
    Object.assign(account, {
      accountCode: input.accountCode ?? account.accountCode,
      accountName: input.accountName ?? account.accountName,
      accountType: input.accountType ?? account.accountType,
      parentAccountId: input.parentAccountId ?? account.parentAccountId,
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
      createdBy: j.createdBy,
      createdAt: j.createdAt,
      lines,
      ...this.totals(lines),
    };
  }

  private totals(lines: { entryType: EntryType; amount: number }[]): {
    totalDebit: number;
    totalCredit: number;
  } {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      if (line.entryType === 'DEBIT') totalDebit += line.amount;
      else totalCredit += line.amount;
    }
    return { totalDebit: round(totalDebit), totalCredit: round(totalCredit) };
  }

  private assertLinesWellFormed(lines: NewJournalInput['lines']): void {
    if (lines.length < 2) {
      throw new DataError('INVALID_ENTRY', 'A journal entry needs at least two lines');
    }
    if (lines.some((l) => l.amount <= 0)) {
      throw new DataError('INVALID_ENTRY', 'Every line amount must be greater than zero');
    }
  }

  private assertBalanced(lines: { entryType: EntryType; amount: number }[]): void {
    const { totalDebit, totalCredit } = this.totals(lines);
    if (totalDebit !== totalCredit) {
      throw new DataError(
        'UNBALANCED_ENTRY',
        `Entry is not balanced: debits ${totalDebit} vs credits ${totalCredit}`,
      );
    }
  }

  private buildLines(entryId: string, input: NewJournalInput['lines']): JournalEntryLine[] {
    return input.map((l) => {
      const account = this.accountById(l.accountId);
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
      createdBy: this.currentUserId ?? seed.users[0].userId,
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
    if (input.entryDate) entry.entryDate = input.entryDate;
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
    entry.status = 'VOIDED';
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
    const product = this.productById(input.productId);
    this.warehouseById(input.warehouseId);

    const row = this.upsertStock(input.productId, input.warehouseId);
    row.quantityOnHand += input.quantity;
    row.updatedAt = new Date().toISOString();

    const movement = this.addMovement(
      input.productId,
      input.warehouseId,
      'GOODS_RECEIPT',
      input.quantity,
      input.unitCost,
      input.referenceId ?? null,
    );

    this.inventoryEntry(
      'INVENTORY_RECEIPT',
      movement.transactionId,
      this.accountByCode(SYSTEM_ACCOUNT_CODES.inventory).accountId,
      this.accountByCode(SYSTEM_ACCOUNT_CODES.accountsPayable).accountId,
      round(input.quantity * input.unitCost),
      `Goods receipt - ${product.sku}`,
    );

    return this.enrichMovement(movement);
  }

  async issue(input: IssueInput): Promise<InventoryTransaction> {
    await this.wait();
    this.requireActor();
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

    const unitCost = input.unitCost ?? 0;
    row!.quantityOnHand -= input.quantity;
    row!.updatedAt = new Date().toISOString();

    const movement = this.addMovement(
      input.productId,
      input.warehouseId,
      'SALES_ISSUE',
      -input.quantity,
      unitCost,
      input.referenceId ?? null,
    );

    this.inventoryEntry(
      'SALES_ISSUE',
      movement.transactionId,
      this.accountByCode(SYSTEM_ACCOUNT_CODES.costOfGoodsSold).accountId,
      this.accountByCode(SYSTEM_ACCOUNT_CODES.inventory).accountId,
      round(input.quantity * unitCost),
      `Sales issue - ${product.sku}`,
    );

    return this.enrichMovement(movement);
  }

  async transfer(input: TransferInput): Promise<InventoryTransaction[]> {
    await this.wait();
    this.requireActor();
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

    const unitCost = 0;
    from!.quantityOnHand -= input.quantity;
    from!.updatedAt = new Date().toISOString();
    const to = this.upsertStock(input.productId, input.toWarehouseId);
    to.quantityOnHand += input.quantity;
    to.updatedAt = new Date().toISOString();

    const out = this.addMovement(
      input.productId,
      input.fromWarehouseId,
      'TRANSFER_OUT',
      -input.quantity,
      unitCost,
      null,
    );
    const into = this.addMovement(
      input.productId,
      input.toWarehouseId,
      'TRANSFER_IN',
      input.quantity,
      unitCost,
      null,
    );
    return [this.enrichMovement(out), this.enrichMovement(into)];
  }

  async adjust(input: AdjustmentInput): Promise<InventoryTransaction> {
    await this.wait();
    this.requireActor();
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
      input.unitCost ?? 0,
      null,
    );
    return this.enrichMovement(movement);
  }

  // ------------------------------------------------------------- reports

  async trialBalance(filter: TrialBalanceFilter): Promise<TrialBalanceRow[]> {
    await this.wait();
    const rows = new Map<string, TrialBalanceRow>();
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
            debit: 0,
            credit: 0,
            net: 0,
          };
          rows.set(line.accountId, row);
        }
        if (line.entryType === 'DEBIT') row.debit += line.amount;
        else row.credit += line.amount;
      }
    }
    return [...rows.values()]
      .map((r) => ({ ...r, debit: round(r.debit), credit: round(r.credit), net: round(r.debit - r.credit) }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
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
