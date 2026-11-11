import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS, seed } from '@erp/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import '../src/config/env';

/**
 * Loads the shared demo dataset (the same one the web mock store uses) with
 * fixed ids, so it is idempotent: re-running updates/creates by id and never
 * duplicates. Users get bcrypt hashes — the plaintext in the shared seed is
 * dev-only data, never stored.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const { company, roles, users, accounts, warehouses, products, stock, movements, journals } =
    seed;

  await prisma.company.upsert({
    where: { companyId: company.companyId },
    update: { name: company.name },
    create: { companyId: company.companyId, name: company.name },
  });

  // Permissions are a global catalog keyed by code.
  await prisma.permission.createMany({
    data: PERMISSIONS.map((code) => ({ code })),
    skipDuplicates: true,
  });
  const permissionIdByCode = new Map(
    (await prisma.permission.findMany()).map((p) => [p.code, p.permissionId]),
  );

  for (const role of roles) {
    await prisma.role.upsert({
      where: { roleId: role.roleId },
      update: { code: role.code, name: role.name },
      create: {
        roleId: role.roleId,
        companyId: role.companyId,
        code: role.code,
        name: role.name,
      },
    });
    await prisma.rolePermission.createMany({
      data: role.permissions
        .map((code) => permissionIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.roleId, permissionId })),
      skipDuplicates: true,
    });
  }

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await prisma.user.upsert({
      where: { userId: user.userId },
      update: {
        email: user.email,
        fullName: user.fullName,
        passwordHash,
        isActive: true,
      },
      create: {
        userId: user.userId,
        companyId: user.companyId,
        email: user.email,
        fullName: user.fullName,
        passwordHash,
      },
    });
    const role = roles.find((r) => r.code === user.roleCode);
    if (role) {
      await prisma.userRole.createMany({
        data: [{ userId: user.userId, roleId: role.roleId }],
        skipDuplicates: true,
      });
    }
  }

  // Accounts list parents before children, so sequential upserts satisfy the FK.
  for (const account of accounts) {
    await prisma.chartOfAccount.upsert({
      where: { accountId: account.accountId },
      update: {
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        parentAccountId: account.parentAccountId,
        isActive: true,
      },
      create: {
        accountId: account.accountId,
        companyId: account.companyId,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        parentAccountId: account.parentAccountId,
      },
    });
  }

  for (const warehouse of warehouses) {
    await prisma.warehouse.upsert({
      where: { warehouseId: warehouse.warehouseId },
      update: { code: warehouse.code, name: warehouse.name, locationAddress: warehouse.locationAddress },
      create: { ...warehouse },
    });
  }

  for (const product of products) {
    await prisma.product.upsert({
      where: { productId: product.productId },
      update: {
        sku: product.sku,
        name: product.name,
        description: product.description,
        unitOfMeasure: product.unitOfMeasure,
        reorderThreshold: product.reorderThreshold,
      },
      create: { ...product },
    });
  }

  for (const s of stock) {
    await prisma.inventoryStock.upsert({
      where: { productId_warehouseId: { productId: s.productId, warehouseId: s.warehouseId } },
      update: { quantityOnHand: s.quantityOnHand, quantityReserved: s.quantityReserved },
      create: {
        companyId: company.companyId,
        productId: s.productId,
        warehouseId: s.warehouseId,
        quantityOnHand: s.quantityOnHand,
        quantityReserved: s.quantityReserved,
      },
    });
  }

  await prisma.inventoryTransaction.createMany({
    data: movements.map((m) => ({ ...m, companyId: company.companyId })),
    skipDuplicates: true,
  });

  for (const journal of journals) {
    const { lines, ...header } = journal;
    const entry = {
      ...header,
      companyId: company.companyId,
      entryDate: new Date(`${header.entryDate}T00:00:00.000Z`),
    };
    // Balance trigger fires when status becomes POSTED, and lines of a POSTED
    // entry are immutable — so insert as DRAFT, add lines, then flip status.
    const targetStatus = header.status;
    await prisma.journalEntry.upsert({
      where: { entryId: journal.entryId },
      update: {
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        status: 'DRAFT',
        postedAt: null,
        createdBy: entry.createdBy,
      },
      create: { ...entry, status: 'DRAFT', postedAt: null, createdAt: entry.createdAt },
    });
    const existingLines = await prisma.journalEntryLine.count({
      where: { entryId: journal.entryId },
    });
    if (existingLines === 0) {
      await prisma.journalEntryLine.createMany({
        data: lines.map((line) => ({ ...line, entryId: journal.entryId })),
      });
    }
    if (targetStatus !== 'DRAFT') {
      await prisma.journalEntry.update({
        where: { entryId: journal.entryId },
        data: { status: targetStatus, postedAt: header.postedAt },
      });
    }  }

  const counts = {
    users: await prisma.user.count(),
    accounts: await prisma.chartOfAccount.count(),
    warehouses: await prisma.warehouse.count(),
    products: await prisma.product.count(),
    stockRows: await prisma.inventoryStock.count(),
    movements: await prisma.inventoryTransaction.count(),
    journals: await prisma.journalEntry.count(),
    lines: await prisma.journalEntryLine.count(),
  };
  console.log('seed complete', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
