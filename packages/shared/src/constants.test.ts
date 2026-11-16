import { describe, expect, it } from 'vitest';
import { signedMovementQuantity } from './constants';

describe('signedMovementQuantity', () => {
  it('keeps the movement ledger signed: positive in, negative out', () => {
    expect(signedMovementQuantity('GOODS_RECEIPT', 5)).toBe(5);
    expect(signedMovementQuantity('TRANSFER_IN', 5)).toBe(5);
    expect(signedMovementQuantity('SALES_ISSUE', 5)).toBe(-5);
    expect(signedMovementQuantity('TRANSFER_OUT', 5)).toBe(-5);
  });

  it('passes an adjustment delta through unchanged', () => {
    expect(signedMovementQuantity('ADJUSTMENT', 5)).toBe(5);
    expect(signedMovementQuantity('ADJUSTMENT', -5)).toBe(-5);
  });
});
