import { randomUUID } from 'node:crypto';
import type { AuthUser, LoginResponse } from '@erp/shared';
import { prisma } from '../../db/db';
import { ApiError } from '../../lib/errors';
import {
  REFRESH_TOKEN_TTL,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshClaims,
} from '../../lib/jwt';
import { verifyPassword } from '../../lib/password';
import { redis } from '../../lib/redis';

const REFRESH_KEY = (jti: string) => `refresh:${jti}`;
const PERM_KEY = (userId: string) => `perm:${userId}`;
const PERM_TTL = 60;

/** Users + role codes + permission codes in one query; also cached for RBAC. */
export async function loadAuthUser(userId: string, companyId: string): Promise<AuthUser> {
  const user = await prisma.user.findFirst({
    where: { userId, companyId, isActive: true },
    include: {
      company: { select: { name: true } },
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account is disabled or no longer exists');

  const roles: string[] = [];
  const permissions = new Set<string>();
  for (const ur of user.roles) {
    roles.push(ur.role.code);
    for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
  }

  // Cache the permission set for requirePermission (short TTL; cleared on logout).
  await redis.set(PERM_KEY(userId), JSON.stringify([...permissions]), 'EX', PERM_TTL);

  return {
    userId: user.userId,
    companyId: user.companyId,
    companyName: user.company.name,
    email: user.email,
    fullName: user.fullName,
    roles,
    permissions: [...permissions],
  };
}

function issueTokens(user: { userId: string; companyId: string }): {
  accessToken: string;
  refreshToken: string;
} {
  const jti = randomUUID();
  const accessToken = signAccessToken({ userId: user.userId, companyId: user.companyId });
  const refreshToken = signRefreshToken({ userId: user.userId, companyId: user.companyId, jti });
  // Track the jti in Redis so refresh tokens can be rotated/revoked.
  void redis.set(REFRESH_KEY(jti), user.userId, 'EX', REFRESH_TOKEN_TTL);
  return { accessToken, refreshToken };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { company: { select: { name: true } } },
  });
  // Same message for unknown email and wrong password (no user enumeration).
  if (!user || !user.isActive) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const authUser = await loadAuthUser(user.userId, user.companyId);
  return { ...issueTokens(user), user: authUser };
}

export async function refresh(token: string): Promise<LoginResponse> {
  const claims: RefreshClaims = verifyRefreshToken(token);
  const stored = await redis.get(REFRESH_KEY(claims.jti));
  if (!stored || stored !== claims.userId) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token was revoked');
  }
  // Rotation: the presented token is consumed; a new pair is issued.
  await redis.del(REFRESH_KEY(claims.jti));

  const authUser = await loadAuthUser(claims.userId, claims.companyId);
  return { ...issueTokens(authUser), user: authUser };
}

export async function logout(refreshToken?: string): Promise<void> {
  if (refreshToken) {
    try {
      await redis.del(REFRESH_KEY(verifyRefreshToken(refreshToken).jti));
    } catch {
      // Already expired/invalid — nothing to revoke.
    }
  }
}

/** Cached permission check used by requirePermission. */
export async function userHasPermission(userId: string, code: string): Promise<boolean> {
  const cached = await redis.get(PERM_KEY(userId));
  if (cached) return (JSON.parse(cached) as string[]).includes(code);
  const user = await prisma.user.findFirst({
    where: { userId, isActive: true },
    select: {
      roles: {
        select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } },
      },
    },
  });
  const permissions = new Set<string>();
  for (const ur of user?.roles ?? []) {
    for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
  }
  await redis.set(PERM_KEY(userId), JSON.stringify([...permissions]), 'EX', PERM_TTL);
  return permissions.has(code);
}
