import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import '../src/config/env';

/**
 * Phase C3 — demo scenario: a month of activity on top of the base seed, so
 * the Dashboard / Journals / Trial Balance pages look alive in screenshots.
 * Idempotent: entries are marked referenceType 'DEMO'; re-running skips if
 * they already exist. Dated RELATIVE to today so the demo always looks recent.
 *
 * Run: npm run db:seed:demo -w apps/api
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '33333333-0000-0000-0000-000000000001';
const REFERENCE_TYPE = 'DEMO';

/** (daysAgo, [debitCode, creditCode, amount, description]) — two lines each. */
type DemoEntry = {
  daysAgo: number;
  lines: [debitCode: string, creditCode: string, amount: number, description: string][];
  posted: boolean;
};

const ENTRIES: DemoEntry[] = [
  {
    daysAgo: 29,
    posted: true,
    lines: [
      ['1000', '3000', 25_000, 'Owner capital injection'],
      ['1200', '2000', 18_400, 'Stock purchase — suppliers'],
    ],
  },
  { daysAgo: 26, posted: true, lines: [['5100', '1000', 3_500, 'Office rent — month 1']] },
  { daysAgo: 24, posted: true, lines: [['1000', '4000', 9_260, 'Weekly cash sales — week 1']] },
  { daysAgo: 22, posted: true, lines: [['5100', '1000', 1_980, 'Utilities and internet']] },
  { daysAgo: 19, posted: true, lines: [['1000', '4000', 11_430, 'Weekly cash sales — week 2']] },
  { daysAgo: 17, posted: true, lines: [['1100', '4000', 6_750, 'Customer invoice — Meridian Ltd']] },
  { daysAgo: 15, posted: true, lines: [['5100', '1010', 320, 'Petty cash — supplies']] },
  { daysAgo: 12, posted: true, lines: [['1000', '4000', 10_515, 'Weekly cash sales — week 3']] },
  { daysAgo: 10, posted: true, lines: [['2000', '1000', 12_000, 'Supplier payment — on account']] },
  { daysAgo: 8, posted: true, lines: [['5100', '1000', 7_200, 'Payroll — month 1']] },
  { daysAgo: 5, posted: true, lines: [['1000', '4000', 13_880, 'Weekly cash sales — week 4']] },
  { daysAgo: 3, posted: true, lines: [['1100', '4000', 4_320, 'Customer invoice — Northwind Co.']] },
  { daysAgo: 1, posted: false, lines: [['5100', '2000', 2_140, 'Utility bill — awaiting payment']] },
  { daysAgo: 1, posted: false, lines: [['1000', '1100', 6_750, 'Receipt — Meridian Ltd (expected)']] },
];

/** Same JE-#### allocation scheme as the API (no concurrency here). */
async function nextEntryNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: bigint | number }[]>`
    SELECT coalesce(max((substring(entry_number from 'JE-([0-9]+)$'))::bigint), 0) AS max
    FROM journal_entries WHERE company_id::text = ${COMPANY_ID}`;
  const max = Number(rows[0]?.max ?? 0);
  return `JE-${String(max + 1).padStart(4, '0')}`;
}

async function main(): Promise<void> {
  const existing = await prisma.journalEntry.count({
    where: { companyId: COMPANY_ID, referenceType: REFERENCE_TYPE },
  });
  if (existing > 0) {
    console.log(`demo seed skipped — ${existing} DEMO entries already exist`);
    return;
  }

  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId: COMPANY_ID },
    select: { accountCode: true, accountId: true },
  });
  const idByCode = new Map(accounts.map((a) => [a.accountCode, a.accountId]));

  let created = 0;
  for (const demo of ENTRIES) {
    const entryDate = new Date(Date.now() - demo.daysAgo * 24 * 60 * 60 * 1000);
    entryDate.setUTCHours(12, 0, 0, 0);
    const entry = await prisma.journalEntry.create({
      data: {
        companyId: COMPANY_ID,
        entryNumber: await nextEntryNumber(),
        entryDate,
        referenceType: REFERENCE_TYPE,
        status: 'DRAFT',
        createdBy: ADMIN_ID,
        createdAt: entryDate,
        lines: {
          create: demo.lines.map(([debitCode, creditCode, amount, description]) => [
            { accountId: idByCode.get(debitCode)!, entryType: 'DEBIT', amount, description },
            { accountId: idByCode.get(creditCode)!, entryType: 'CREDIT', amount, description: null },
          ]).flat(),
        },
      },
    });
    if (demo.posted) {
      await prisma.journalEntry.update({
        where: { entryId: entry.entryId },
        data: { status: 'POSTED', postedAt: entryDate },
      });
    }
    created++;
  }

  const counts = {
    demoEntries: await prisma.journalEntry.count({
      where: { companyId: COMPANY_ID, referenceType: REFERENCE_TYPE },
    }),
    posted: await prisma.journalEntry.count({
      where: { companyId: COMPANY_ID, referenceType: REFERENCE_TYPE, status: 'POSTED' },
    }),
  };
  console.log(`demo seed complete — created ${created} entries`, counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
