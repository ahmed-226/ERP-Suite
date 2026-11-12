import { SYSTEM_ACCOUNT_CODES } from '@erp/shared';
import type { PrismaTx } from '../inventory/inventory.view';
import { nextEntryNumber } from '../journals/journal.view';

/**
 * Cross-module integration (WORKFLOWS.md §7–8): an inventory receipt posts
 * DR {inventory} / CR {accountsPayable}, a sales issue posts
 * DR {costOfGoodsSold} / CR {inventory}. The entry is created DRAFT (so the
 * immutability trigger lets lines in), then flipped POSTED — the balance
 * trigger guards the flip.
 */
export async function postInventoryJournal(
  tx: PrismaTx,
  args: {
    companyId: string;
    userId: string;
    entryDate: Date;
    referenceType: 'INVENTORY_RECEIPT' | 'SALES_ISSUE';
    referenceId: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
  },
): Promise<string> {
  const entryNumber = await nextEntryNumber(tx, args.companyId);
  const entry = await tx.journalEntry.create({
    data: {
      companyId: args.companyId,
      entryNumber,
      entryDate: args.entryDate,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      status: 'DRAFT',
      createdBy: args.userId,
      lines: {
        create: [
          {
            accountId: args.debitAccountId,
            entryType: 'DEBIT',
            amount: args.amount,
            description: args.referenceType === 'INVENTORY_RECEIPT' ? 'Goods receipt' : 'Cost of goods sold',
          },
          {
            accountId: args.creditAccountId,
            entryType: 'CREDIT',
            amount: args.amount,
          },
        ],
      },
    },
  });
  await tx.journalEntry.update({
    where: { entryId: entry.entryId },
    data: { status: 'POSTED', postedAt: new Date() },
  });
  return entry.entryId;
}

/** Resolves the system account ids for the company, by code. */
export async function systemAccountIds(
  tx: PrismaTx,
  companyId: string,
): Promise<{ inventory: string; accountsPayable: string; costOfGoodsSold: string }> {
  const accounts = await tx.chartOfAccount.findMany({
    where: {
      companyId,
      accountCode: {
        in: [
          SYSTEM_ACCOUNT_CODES.inventory,
          SYSTEM_ACCOUNT_CODES.accountsPayable,
          SYSTEM_ACCOUNT_CODES.costOfGoodsSold,
        ],
      },
    },
    select: { accountCode: true, accountId: true },
  });
  const byCode = new Map(accounts.map((a) => [a.accountCode, a.accountId]));
  const missing = ['1200', '2000', '5000'].filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw new Error(`System account(s) missing: ${missing.join(', ')}`);
  }
  return {
    inventory: byCode.get(SYSTEM_ACCOUNT_CODES.inventory)!,
    accountsPayable: byCode.get(SYSTEM_ACCOUNT_CODES.accountsPayable)!,
    costOfGoodsSold: byCode.get(SYSTEM_ACCOUNT_CODES.costOfGoodsSold)!,
  };
}
