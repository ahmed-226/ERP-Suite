import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';

const UNKNOWN = { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };

/** Final handler: always answers with the shared error envelope. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = UNKNOWN.status;
  let code = UNKNOWN.code;
  let message = UNKNOWN.message;
  let details: unknown;

  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.flatten();
  } else if (isPrismaKnownRequestError(err)) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with the same unique value already exists';
      details = { target: err.meta?.target };
    } else if (err.code === 'P2003') {
      status = 422;
      code = 'FOREIGN_KEY_VIOLATION';
      message = 'The request references a related record that does not exist or is in use';
      details = { field: err.meta?.field_name ?? err.meta?.field };
    }
  } else if (typeof err === 'object' && err !== null && 'type' in err) {
    // express.json() body-parser failures
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body is not valid JSON';
    }
  }

  if (status >= 500) {
    req.log.error({ err, reqId: req.id }, 'unhandled request error');
  }

  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

function isPrismaKnownRequestError(
  err: unknown,
): err is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string' &&
    /^P\d{4}$/.test((err as { code: string }).code)
  );
}
