import { beforeEach, describe, expect, it } from 'vitest';
import { REVERSAL_REFERENCE_TYPE, seed } from '@erp/shared';
import { MockStore } from './store';

const [cash, , , inventory, accountsPayable, , , cogs] = seed.accounts;
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
});
