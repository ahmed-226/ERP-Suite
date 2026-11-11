/**
 * Typed API error carrying the stable error envelope codes the web mock store
 * already surfaces (`{ error: { code, message, details? } }`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string): ApiError =>
  new ApiError(404, 'NOT_FOUND', `${what} not found`);
