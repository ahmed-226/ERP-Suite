import Decimal from 'decimal.js';

export { Decimal };

/**
 * Ledger amounts are stored as NUMERIC(15,4). Every balance check and report
 * total must stay in this exact decimal domain — summing `Number(decimal)` is
 * what turns 0.1 + 0.2 into 0.30000000000000004 and can reject a valid entry.
 */
export const MONEY_DECIMAL_PLACES = 4;

/** Anything that reads as an exact decimal: Prisma Decimal, string or number. */
export type MoneyInput = Decimal | string | number | { toString(): string };

export function money(value: MoneyInput): Decimal {
  return new Decimal(value.toString());
}

export function sumMoney(values: Iterable<MoneyInput>): Decimal {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(money(value));
  return total;
}

/** Debits are positive, credits negative — the sign used by the balance guard. */
export function signedAmount(entryType: 'DEBIT' | 'CREDIT', amount: MoneyInput): Decimal {
  const value = money(amount);
  return entryType === 'DEBIT' ? value : value.negated();
}

/** Round to the stored scale and return the number shape used by API contracts. */
export function moneyToNumber(value: MoneyInput): number {
  return money(value).toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP).toNumber();
}
