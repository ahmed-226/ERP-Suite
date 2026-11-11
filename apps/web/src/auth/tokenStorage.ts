import type { LoginResponse } from '@erp/shared';

const ACCESS_KEY = 'erp.auth.accessToken';
const REFRESH_KEY = 'erp.auth.refreshToken';

/** Token persistence shared by the mock and (Stage C) the HTTP data source. */
export function saveTokens(response: Pick<LoginResponse, 'accessToken' | 'refreshToken'>): void {
  try {
    localStorage.setItem(ACCESS_KEY, response.accessToken);
    localStorage.setItem(REFRESH_KEY, response.refreshToken);
  } catch {
    // Storage unavailable - tokens stay in memory for this session only.
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}
