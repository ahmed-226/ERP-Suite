/**
 * Phase C2 — golden-path E2E smoke. Expects the API on :4000 backed by a
 * FRESHLY seeded database (scripts/e2e.sh does reset + boot). Walks:
 *   login → create COA → receipt → verify stock + auto-journal →
 *   trial balance → issue → movement history.
 * Every step is a hard assertion; any failure exits non-zero.
 */
const BASE = 'http://localhost:4000/api/v1';
const YEAR = new Date().getFullYear();
const TB_RANGE = `from=${YEAR}-01-01&to=${YEAR}-12-31`;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log('== login ==');
  const login = await api('POST', '/auth/login', undefined, {
    email: 'admin@acme.test',
    password: 'Passw0rd!',
  });
  check('login 200 with accessToken', login.status === 200 && typeof login.body.accessToken === 'string', login);
  const tok = login.body.accessToken as string;

  console.log('== chart of accounts ==');
  const accountsBefore = await api('GET', '/accounts', tok);
  check('accounts list 200', accountsBefore.status === 200);
  const create = await api('POST', '/accounts', tok, {
    accountCode: '9999',
    accountName: 'E2E Smoke Account',
    accountType: 'EXPENSE',
  });
  check('create account 201', create.status === 201, create);
  const accountsAfter = await api('GET', '/accounts', tok);
  check(
    'account list grew by one and contains 9999',
    accountsAfter.body.length === accountsBefore.body.length + 1 &&
      accountsAfter.body.some((a: any) => a.accountCode === '9999'),
  );

  console.log('== baseline (stock + trial balance) ==');
  const stockRows = await api('GET', '/inventory/stock', tok);
  check('stock list 200', stockRows.status === 200);
  const row = stockRows.body[0];
  check('seeded stock row exists', Boolean(row));
  const productId = row.productId as string;
  const warehouseId = row.warehouseId as string;
  const qty0 = row.quantityOnHand as number;
  const products = await api('GET', '/products', tok);
  const sku = products.body.find((p: any) => p.productId === productId)?.sku ?? productId;

  const tb0 = await api('GET', `/reports/trial-balance?${TB_RANGE}`, tok);
  check('trial balance 200', tb0.status === 200);
  const sum = (rows: any[], key: 'debit' | 'credit') =>
    rows.reduce((s, r) => s + r[key], 0);
  const debit0 = sum(tb0.body, 'debit');
  const credit0 = sum(tb0.body, 'credit');
  check('baseline trial balance is balanced', Math.abs(debit0 - credit0) < 0.005, { debit0, credit0 });

  console.log('== receipt ==');
  const receipt = await api('POST', '/inventory/receipts', tok, {
    productId,
    warehouseId,
    quantity: 10,
    unitCost: 25,
  });
  check('receipt 201 GOODS_RECEIPT', receipt.status === 201 && receipt.body.movementType === 'GOODS_RECEIPT', receipt);
  const txId = receipt.body.transactionId as string;

  const stockAfterReceipt = await api('GET', `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`, tok);
  check(
    `stock ${qty0} -> ${qty0 + 10}`,
    stockAfterReceipt.body[0]?.quantityOnHand === qty0 + 10,
    stockAfterReceipt.body[0],
  );

  const receiptEntry = (await api('GET', '/journals?referenceType=INVENTORY_RECEIPT', tok)).body.find(
    (e: any) => e.referenceId === txId,
  );
  check('receipt auto-journal exists and is POSTED', Boolean(receiptEntry) && receiptEntry.status === 'POSTED', receiptEntry);
  check(
    'receipt journal: DR 1200 / CR 2000 x 250',
    receiptEntry.totalDebit === 250 &&
      receiptEntry.totalCredit === 250 &&
      receiptEntry.lines.some((l: any) => l.entryType === 'DEBIT' && l.accountCode === '1200' && l.amount === 250) &&
      receiptEntry.lines.some((l: any) => l.entryType === 'CREDIT' && l.accountCode === '2000' && l.amount === 250),
    receiptEntry,
  );

  console.log('== trial balance after receipt ==');
  const tb1 = await api('GET', `/reports/trial-balance?${TB_RANGE}`, tok);
  const debit1 = sum(tb1.body, 'debit');
  const credit1 = sum(tb1.body, 'credit');
  check(
    'trial balance grew by exactly 250 on each side',
    Math.abs(debit1 - (debit0 + 250)) < 0.005 && Math.abs(credit1 - (credit0 + 250)) < 0.005,
    { debit0, debit1, credit0, credit1 },
  );

  console.log('== issue ==');
  const issue = await api('POST', '/inventory/issues', tok, {
    productId,
    warehouseId,
    quantity: 3,
    unitCost: 25,
  });
  check('issue 201 SALES_ISSUE', issue.status === 201 && issue.body.movementType === 'SALES_ISSUE', issue);
  const issueTxId = issue.body.transactionId as string;

  const stockAfterIssue = await api('GET', `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`, tok);
  check(
    `stock ${qty0 + 10} -> ${qty0 + 7}`,
    stockAfterIssue.body[0]?.quantityOnHand === qty0 + 7,
    stockAfterIssue.body[0],
  );

  const issueEntry = (await api('GET', '/journals?referenceType=SALES_ISSUE', tok)).body.find(
    (e: any) => e.referenceId === issueTxId,
  );
  check('issue auto-journal exists and is POSTED', Boolean(issueEntry) && issueEntry.status === 'POSTED', issueEntry);
  check(
    'issue journal: DR 5000 / CR 1200 x 75',
    issueEntry.totalDebit === 75 &&
      issueEntry.totalCredit === 75 &&
      issueEntry.lines.some((l: any) => l.entryType === 'DEBIT' && l.accountCode === '5000' && l.amount === 75) &&
      issueEntry.lines.some((l: any) => l.entryType === 'CREDIT' && l.accountCode === '1200' && l.amount === 75),
    issueEntry,
  );

  console.log('== movement history ==');
  const movements = await api('GET', `/inventory/movements?productId=${productId}`, tok);
  check('movements list 200, newest first', movements.status === 200 && movements.body.length >= 2);
  const issueMv = movements.body[0];
  const receiptMv = movements.body.find((m: any) => m.transactionId === txId);
  check(
    'latest movement is our issue (qty 3, cost 25)',
    issueMv?.transactionId === issueTxId && issueMv.quantity === 3 && issueMv.unitCost === 25,
    issueMv,
  );
  check(
    'history contains our receipt (qty 10, cost 25)',
    Boolean(receiptMv) && receiptMv.quantity === 10 && receiptMv.unitCost === 25,
    receiptMv,
  );
  console.log(`  (product ${sku}, warehouse ${row.warehouseCode})`);

  console.log(`\nE2E smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('E2E smoke crashed:', err);
  process.exit(1);
});
