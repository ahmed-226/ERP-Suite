import { beforeEach, describe, expect, it } from 'vitest';
import { REVERSAL_REFERENCE_TYPE, seed } from '@erp/shared';
import { MockStore } from './store';

const [cash, , , inventory, accountsPayable, , , cogs, operatingExpenses] = seed.accounts;
const mainWarehouse = seed.warehouses[0].warehouseId;
const secondaryWarehouse = seed.warehouses[1].warehouseId;
const [mouse, , monitor] = seed.products;

/** Every mutation requires a signed-in actor, so tests log in as the admin. */
async function newStore(): Promise<MockStore> {
  const store = new MockStore({ latency: 0 });
  await store.login({ email: 'admin@acme.test', password: 'Passw0rd!' });
  return store;
}

beforeEach(() => {
  localStorage.clear();
});

describe('MockStore journal invariants', () => {
  it('refuses to post an unbalanced entry', async () => {
    const store = await newStore();
    const entry = await store.createJournal({
      entryDate: '2026-02-01',
      lines: [
        { accountId: cogs.accountId, entryType: 'DEBIT', amount: 100 },
        { accountId: cash.accountId, entryType: 'CREDIT', amount: 90 },
      ],
    });

    await expect(store.postJournal(entry.entryId)).rejects.toMatchObject({
      code: 'UNBALANCED_ENTRY',
    });
  });

  it('posts a balanced entry and keeps the trial balance at zero', async () => {
    const store = await newStore();
    const entry = await store.createJournal({
      entryDate: '2026-02-01',
      lines: [
        { accountId: cogs.accountId, entryType: 'DEBIT', amount: 100 },
        { accountId: cash.accountId, entryType: 'CREDIT', amount: 100 },
      ],
    });
    const posted = await store.postJournal(entry.entryId);
    expect(posted.status).toBe('POSTED');

    const rows = await store.trialBalance({ from: '2000-01-01', to: '2100-01-01' });
    const net = rows.reduce((sum, row) => sum + row.net, 0);
    expect(Math.round(net * 10000) / 10000).toBe(0);
  });

  it('will not edit a posted entry', async () => {
    const store = await newStore();
    const [postedEntry] = await store.listJournals({ status: 'POSTED' });
    await expect(
      store.updateJournal(postedEntry.entryId, { entryDate: '2026-03-01' }),
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_EDITABLE' });
  });

  it('refuses lines on an inactive account when creating or posting', async () => {
    const store = await newStore();
    const lines = () => [
      { accountId: cogs.accountId, entryType: 'DEBIT' as const, amount: 10 },
      { accountId: cash.accountId, entryType: 'CREDIT' as const, amount: 10 },
    ];

    const draft = await store.createJournal({ entryDate: '2026-02-01', lines: lines() });
    await store.updateAccount(cogs.accountId, { isActive: false });

    await expect(store.postJournal(draft.entryId)).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    });
    await expect(
      store.createJournal({ entryDate: '2026-02-01', lines: lines() }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('voids a draft in place', async () => {
    const store = await newStore();
    const draft = await store.createJournal({
      entryDate: '2026-02-01',
      lines: [
        { accountId: cogs.accountId, entryType: 'DEBIT', amount: 10 },
        { accountId: cash.accountId, entryType: 'CREDIT', amount: 10 },
      ],
    });

    const voided = await store.voidJournal(draft.entryId);
    expect(voided.status).toBe('VOIDED');
    expect(voided.reversedByEntryId).toBeNull();
  });

  it('reverses a posted entry instead of erasing it', async () => {
    const store = await newStore();
    const entry = await store.createJournal({
      entryDate: '2026-02-01',
      lines: [
        { accountId: cogs.accountId, entryType: 'DEBIT', amount: 100 },
        { accountId: cash.accountId, entryType: 'CREDIT', amount: 100 },
      ],
    });
    await store.postJournal(entry.entryId);
    // Reversals are dated today, so the original period must not move.
    const range = { from: '2026-02-01', to: '2026-02-01' };
    const before = await store.trialBalance(range);

    const voided = await store.voidJournal(entry.entryId);
    expect(voided.status).toBe('POSTED');
    expect(voided.reversedByEntryId).toBeTruthy();

    const reversal = await store.getJournal(voided.reversedByEntryId as string);
    expect(reversal.status).toBe('POSTED');
    expect(reversal.referenceType).toBe(REVERSAL_REFERENCE_TYPE);
    expect(reversal.referenceId).toBe(entry.entryId);
    expect(reversal.lines.map((line) => line.entryType)).toEqual(['CREDIT', 'DEBIT']);

    // The pair nets to zero, so balances are unchanged and history survives.
    expect(await store.trialBalance(range)).toEqual(before);

    await expect(store.voidJournal(entry.entryId)).rejects.toMatchObject({
      code: 'ENTRY_ALREADY_VOID',
    });
  });
});

describe('MockStore account guards', () => {
  it('rejects a parent that would create a cycle', async () => {
    const store = await newStore();
    const parent = await store.createAccount({
      accountCode: 'T-9001',
      accountName: 'Cycle parent',
      accountType: 'ASSET',
    });
    const child = await store.createAccount({
      accountCode: 'T-9002',
      accountName: 'Cycle child',
      accountType: 'ASSET',
      parentAccountId: parent.accountId,
    });

    await expect(
      store.updateAccount(parent.accountId, { parentAccountId: child.accountId }),
    ).rejects.toMatchObject({ code: 'INVALID_PARENT', status: 422 });
    await expect(
      store.updateAccount(parent.accountId, { parentAccountId: parent.accountId }),
    ).rejects.toMatchObject({ code: 'INVALID_PARENT' });

    const cleared = await store.updateAccount(parent.accountId, { parentAccountId: null });
    expect(cleared.parentAccountId).toBeNull();
  });

  it('rejects retyping an account that has journal lines', async () => {
    const store = await newStore();
    const account = await store.createAccount({
      accountCode: 'T-9003',
      accountName: 'Used account',
      accountType: 'ASSET',
    });
    await store.createJournal({
      entryDate: '2026-02-01',
      lines: [
        { accountId: account.accountId, entryType: 'DEBIT', amount: 10 },
        { accountId: account.accountId, entryType: 'CREDIT', amount: 10 },
      ],
    });

    await expect(
      store.updateAccount(account.accountId, { accountType: 'EXPENSE' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_TYPE_IN_USE', status: 409 });

    const retired = await store.updateAccount(account.accountId, { isActive: false });
    expect(retired.isActive).toBe(false);
  });
});

describe('MockStore inventory invariants', () => {
  it('blocks an issue larger than the stock on hand', async () => {
    const store = await newStore();
    await expect(
      store.issue({ productId: monitor.productId, warehouseId: mainWarehouse, quantity: 5 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('receives stock and records a balanced journal entry', async () => {
    const store = await newStore();
    const before = (await store.listStock({ productId: mouse.productId, warehouseId: mainWarehouse }))[0];

    const movement = await store.receipt({
      productId: mouse.productId,
      warehouseId: mainWarehouse,
      quantity: 10,
      unitCost: 5,
    });
    expect(movement.movementType).toBe('GOODS_RECEIPT');
    expect(movement.quantity).toBe(10);

    const after = (await store.listStock({ productId: mouse.productId, warehouseId: mainWarehouse }))[0];
    expect(after.quantityOnHand).toBe(before.quantityOnHand + 10);

    const entry = await store.getJournal(
      (await store.listJournals({ referenceType: 'INVENTORY_RECEIPT' }))[0].entryId,
    );
    expect(entry.status).toBe('POSTED');
    expect(entry.totalDebit).toBe(entry.totalCredit);
  });

  it('transfers stock between warehouses', async () => {
    const store = await newStore();
    const [out, into] = await store.transfer({
      productId: mouse.productId,
      fromWarehouseId: mainWarehouse,
      toWarehouseId: secondaryWarehouse,
      quantity: 15,
    });
    expect(out.movementType).toBe('TRANSFER_OUT');
    expect(out.quantity).toBe(-15);
    expect(into.movementType).toBe('TRANSFER_IN');
    expect(into.quantity).toBe(15);
  });

  it('exposes the integration accounts used by inventory postings', () => {
    expect(inventory.accountCode).toBe('1200');
    expect(accountsPayable.accountCode).toBe('2000');
    expect(cogs.accountCode).toBe('5000');
  });

  it('blends receipts into the average and prices every outflow server-side', async () => {
    const store = await newStore();
    const product = await store.createProduct({ sku: 'AVG-TEST-1', name: 'Average test product' });
    expect(product.averageCost).toBe(0);

    await store.receipt({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 10,
      unitCost: 10,
    });
    await store.receipt({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 10,
      unitCost: 20,
    });
    expect((await store.getProduct(product.productId)).averageCost).toBe(15);

    const issue = await store.issue({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 4,
    });
    expect(issue.unitCost).toBe(15);

    const adjustment = await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: -2,
      reason: 'Damage',
    });
    expect(adjustment.unitCost).toBe(15);

    const [out, into] = await store.transfer({
      productId: product.productId,
      fromWarehouseId: mainWarehouse,
      toWarehouseId: secondaryWarehouse,
      quantity: 3,
    });
    expect(out.unitCost).toBe(15);
    expect(into.unitCost).toBe(15);

    const report = await store.inventoryValuation();
    expect(report.rows.find((row) => row.productId === product.productId)).toMatchObject({
      quantityOnHand: 14,
      averageCost: 15,
      value: 210,
    });
    const summed = report.rows.reduce((sum, row) => sum + row.value, 0);
    expect(report.totalValue).toBeCloseTo(summed, 4);
  });

  it('posts adjustment write-offs and gains against operating expenses', async () => {
    const store = await newStore();
    const product = await store.createProduct({ sku: 'ADJ-TEST-1', name: 'Adjustment product' });
    await store.receipt({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 10,
      unitCost: 10,
    });

    const writeOff = await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: -2,
      reason: 'Damaged',
    });
    const loss = (await store.listJournals({})).find(
      (entry) => entry.referenceId === writeOff.transactionId,
    );
    expect(loss?.status).toBe('POSTED');
    expect(loss?.lines.find((line) => line.entryType === 'DEBIT')?.accountId).toBe(
      operatingExpenses.accountId,
    );
    expect(loss?.lines.find((line) => line.entryType === 'CREDIT')?.accountId).toBe(
      inventory.accountId,
    );
    expect(loss?.totalDebit).toBe(20);

    const gain = await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: 2,
      reason: 'Found stock',
    });
    const found = (await store.listJournals({})).find(
      (entry) => entry.referenceId === gain.transactionId,
    );
    expect(found?.lines.find((line) => line.entryType === 'DEBIT')?.accountId).toBe(
      inventory.accountId,
    );
    expect(found?.lines.find((line) => line.entryType === 'CREDIT')?.accountId).toBe(
      operatingExpenses.accountId,
    );
  });

  it('keeps inventory GL equal to the valuation report for fully posted activity', async () => {
    const store = await newStore();
    const inventoryNet = async (): Promise<number> => {
      const row = (await store.trialBalance({ from: '2000-01-01', to: '2100-01-01' })).find(
        (r) => r.accountId === inventory.accountId,
      );
      return row?.net ?? 0;
    };
    const before = await inventoryNet();

    const product = await store.createProduct({ sku: 'RECON-TEST-1', name: 'Reconciliation product' });
    await store.receipt({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 10,
      unitCost: 10,
    });
    await store.issue({ productId: product.productId, warehouseId: mainWarehouse, quantity: 2 });
    await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: -3,
      reason: 'Shrinkage',
    });
    await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: 1,
      reason: 'Count gain',
    });
    await store.transfer({
      productId: product.productId,
      fromWarehouseId: mainWarehouse,
      toWarehouseId: secondaryWarehouse,
      quantity: 2,
    });

    const row = (await store.inventoryValuation()).rows.find(
      (r) => r.productId === product.productId,
    );
    expect(row).toMatchObject({ quantityOnHand: 6, averageCost: 10, value: 60 });
    expect((await inventoryNet()) - before).toBeCloseTo(row!.value, 4);
  });

  it('posts nothing for zero-value movements', async () => {
    const store = await newStore();
    const product = await store.createProduct({ sku: 'ZERO-TEST-1', name: 'Zero value product' });

    const receipt = await store.receipt({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 5,
      unitCost: 0,
    });
    const issue = await store.issue({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantity: 1,
    });
    const adjustment = await store.adjust({
      productId: product.productId,
      warehouseId: mainWarehouse,
      quantityDelta: 2,
      reason: 'Count gain',
    });

    const movements = new Set([
      receipt.transactionId,
      issue.transactionId,
      adjustment.transactionId,
    ]);
    const entries = (await store.listJournals({})).filter(
      (entry) => entry.referenceId !== null && movements.has(entry.referenceId),
    );
    expect(entries).toHaveLength(0);
  });
});
