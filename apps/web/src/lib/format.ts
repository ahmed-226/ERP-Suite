import type { AccountType, JournalStatus, MovementType } from '@erp/shared';

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDate(value: string): string {
  return value.slice(0, 10);
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  ASSET: 'blue',
  LIABILITY: 'orange',
  EQUITY: 'purple',
  REVENUE: 'green',
  EXPENSE: 'red',
};

export const JOURNAL_STATUS_COLORS: Record<JournalStatus, string> = {
  DRAFT: 'default',
  POSTED: 'green',
  VOIDED: 'red',
};

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  GOODS_RECEIPT: 'Goods Receipt',
  SALES_ISSUE: 'Sales Issue',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  ADJUSTMENT: 'Adjustment',
};
