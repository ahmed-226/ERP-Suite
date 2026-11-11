import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './errors';

/** 15-minute access token; the refresh token (7 days) is tracked in Redis. */
const ACCESS_TTL = '15m';
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AccessClaims {
  userId: string;
  companyId: string;
}

export interface RefreshClaims extends AccessClaims {
  jti: string;
}

function sign(payload: object, ttl: string): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl as jwt.SignOptions['expiresIn'] });
}

export function signAccessToken(claims: AccessClaims): string {
  return sign(claims, ACCESS_TTL);
}

export function signRefreshToken(claims: RefreshClaims): string {
  return sign(claims, `${REFRESH_TTL_SECONDS}s`);
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AccessClaims;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET) as RefreshClaims;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token');
  }
}

export const REFRESH_TOKEN_TTL = REFRESH_TTL_SECONDS;
