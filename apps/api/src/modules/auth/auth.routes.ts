import { Router } from 'express';
import { loginSchema } from '@erp/shared';
import { rateLimit } from '../../lib/rate-limit';
import { requireAuth } from '../../middleware/auth';
import { loadAuthUser, login, logout, refresh } from './auth.service';

export const authRouter = Router();

/** POST /api/v1/auth/login — throttled harder than the rest of the API. */
authRouter.post('/login', rateLimit({ key: 'login', windowSeconds: 60, max: 10 }), async (req, res) => {
  const input = loginSchema.parse(req.body);
  res.status(200).json(await login(input.email, input.password));
});

/** POST /api/v1/auth/refresh — rotates the refresh token. */
authRouter.post('/refresh', async (req, res) => {
  const body = req.body as { refreshToken?: string };
  if (!body.refreshToken) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'refreshToken is required' } });
    return;
  }
  res.status(200).json(await refresh(body.refreshToken));
});

/** POST /api/v1/auth/logout — revokes the presented refresh token. */
authRouter.post('/logout', requireAuth, async (req, res) => {
  const body = req.body as { refreshToken?: string };
  await logout(body.refreshToken);
  res.status(204).send();
});

/** GET /api/v1/auth/me — current user, roles and permissions. */
authRouter.get('/me', requireAuth, async (req, res) => {
  res.status(200).json(await loadAuthUser(req.user!.userId, req.user!.companyId));
});
