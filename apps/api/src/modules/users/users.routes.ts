import { Router } from 'express';
import { assignRoleSchema, type AdminUser, type RoleInfo } from '@erp/shared';
import { prisma } from '../../db/db';
import { notFound } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';

export const userRouter = Router();

const serializeRole = (
  role: { roleId: string; code: string; name: string; permissions: { permission: { code: string } }[] },
): RoleInfo => ({
  roleId: role.roleId,
  code: role.code,
  name: role.name,
  permissions: role.permissions.map((rp) => rp.permission.code),
});

const serializeUser = (
  user: PrismaUserWithRoles,
): AdminUser => ({
  userId: user.userId,
  companyId: user.companyId,
  email: user.email,
  fullName: user.fullName,
  isActive: user.isActive,
  roles: user.roles.map((ur) => serializeRole(ur.role)),
});

export interface PrismaUserWithRoles {
  userId: string;
  companyId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: { role: { roleId: string; code: string; name: string; permissions: { permission: { code: string } }[] } }[];
}

userRouter.use(requireAuth);

/** GET /users — users & roles administration screen. */
userRouter.get('/', requirePermission('users:read'), async (req, res) => {
  const users = await prisma.user.findMany({
    where: { companyId: req.user!.companyId },
    orderBy: { email: 'asc' },
    include: {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: { select: { code: true } } } } },
          },
        },
      },
    },
  });
  res.status(200).json(users.map(serializeUser));
});

/** GET /users/roles — the company's roles with flattened permissions. */
userRouter.get('/roles', requirePermission('users:read'), async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { companyId: req.user!.companyId },
    orderBy: { code: 'asc' },
    include: { permissions: { include: { permission: { select: { code: true } } } } },
  });
  res.status(200).json(roles.map(serializeRole));
});

/** POST /users/:userId/role — replaces the user's single role assignment. */
userRouter.post('/:userId/role', requirePermission('users:write'), async (req, res) => {
  const input = assignRoleSchema.parse(req.body);
  const userId = req.params.userId as string;
  const user = await prisma.user.findFirst({
    where: { userId, companyId: req.user!.companyId },
    select: { userId: true },
  });
  if (!user) throw notFound('User');
  const role = await prisma.role.findFirst({
    where: { roleId: input.roleId, companyId: req.user!.companyId },
    select: { roleId: true },
  });
  if (!role) throw notFound('Role');

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.create({ data: { userId, roleId: input.roleId } }),
  ]);

  // Role change invalidates the cached permission set immediately.
  const { redis } = await import('../../lib/redis');
  await redis.del(`perm:${userId}`);
  const updated = await prisma.user.findUniqueOrThrow({
    where: { userId },
    include: {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: { select: { code: true } } } } },
          },
        },
      },
    },
  });
  res.status(200).json(serializeUser(updated));
});
