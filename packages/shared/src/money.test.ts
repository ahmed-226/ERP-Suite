import { describe, expect, it } from 'vitest';
import { moneyToNumber, signedAmount, sumMoney } from './money';

describe('exact money arithmetic', () => {
  it('adds decimal amounts without float drift', () => {
    expect(sumMoney([0.1, 0.2]).toString()).toBe('0.3');
    expect(moneyToNumber(sumMoney([0.1, 0.2]))).toBe(0.3);
  });

  it('nets signed debit and credit lines to exactly zero', () => {
    const balance = sumMoney([
      signedAmount('DEBIT', 0.1),
      signedAmount('DEBIT', 0.2),
      signedAmount('CREDIT', 0.3),
    ]);
    expect(balance.isZero()).toBe(true);
  });

  it('honours the NUMERIC(15,4) scale', () => {
    expect(sumMoney(['123456789.1234', '0.0001']).toString()).toBe('123456789.1235');
    expect(moneyToNumber('123456789.12345')).toBe(123456789.1235);
  });
});
