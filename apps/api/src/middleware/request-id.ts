import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Attach a request id (honoring an inbound `x-request-id`) and echo it back. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.id = inbound && inbound.length <= 64 ? inbound : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
