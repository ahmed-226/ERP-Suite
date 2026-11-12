import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { LoginResponse } from '@erp/shared';
import { DataError } from '../errors';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '@/auth/tokenStorage';

/**
 * The HTTP transport behind the `http` data source. One axios instance carries
 * the session: it attaches the bearer token, maps the API's error envelope onto
 * `DataError`, and transparently refreshes an expired access token once before
 * retrying the failed request.
 */

/** Retried requests carry this marker so a second 401 never loops. */
interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/** Endpoints whose 401s are answers, not expired sessions. */
const AUTH_PATHS = ['/auth/login', '/auth/refresh'];

function isAuthPath(url?: string): boolean {
  return AUTH_PATHS.some((path) => (url ?? '').endsWith(path));
}

function readEnvelope(data: unknown): { code: string; message: string } | null {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const envelope = (data as { error: { code?: unknown; message?: unknown } }).error;
    if (typeof envelope?.code === 'string') {
      return {
        code: envelope.code,
        message: typeof envelope.message === 'string' ? envelope.message : 'Request failed',
      };
    }
  }
  return null;
}

/** Normalize every failure (envelope, bare HTTP status, network) to `DataError`. */
function toDataError(error: unknown): DataError {
  const axError = error as AxiosError | undefined;
  const response = axError?.response;
  if (!response) {
    return new DataError('NETWORK_ERROR', axError?.message ?? 'Network request failed', 0);
  }
  const envelope = readEnvelope(response.data);
  if (envelope) return new DataError(envelope.code, envelope.message, response.status);
  return new DataError(
    response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
    axError?.message ?? 'Request failed',
    response.status,
  );
}

export interface ApiClient {
  /** Authenticated instance: bearer token, 401→refresh→retry, error mapping. */
  client: AxiosInstance;
  /** Rotate the token pair (single-flight); the new pair replaces the stored one. */
  refreshSession(): Promise<LoginResponse>;
}

export function createApiClient(config: {
  baseURL: string;
  adapter?: AxiosRequestConfig['adapter'];
}): ApiClient {
  const base: AxiosRequestConfig = {
    baseURL: config.baseURL,
    ...(config.adapter ? { adapter: config.adapter } : {}),
  };
  const client = axios.create(base);
  // Refresh calls bypass the interceptors so they can never refresh themselves.
  const raw = axios.create(base);

  client.interceptors.request.use((request) => {
    const token = getAccessToken();
    if (token) request.headers.Authorization = `Bearer ${token}`;
    return request;
  });

  let refreshInFlight: Promise<LoginResponse> | null = null;

  function refreshSession(): Promise<LoginResponse> {
    refreshInFlight ??= (async (): Promise<LoginResponse> => {
      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new DataError('UNAUTHENTICATED', 'Not signed in', 401);
        const { data } = await raw.post<LoginResponse>('/auth/refresh', { refreshToken });
        saveTokens(data);
        return data;
      } catch (err) {
        // The presented refresh token is dead or missing: the session is over.
        clearTokens();
        throw err instanceof DataError ? err : toDataError(err);
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  client.interceptors.response.use(undefined, async (error) => {
    const config = error?.config as RetryConfig | undefined;
    const expired =
      config && error.response?.status === 401 && !config._retry && !isAuthPath(config.url);
    if (!expired || !getRefreshToken()) {
      throw toDataError(error);
    }
    config._retry = true;
    const { accessToken } = await refreshSession();
    config.headers.Authorization = `Bearer ${accessToken}`;
    return client.request(config);
  });

  return { client, refreshSession };
}
