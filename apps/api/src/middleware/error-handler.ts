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
