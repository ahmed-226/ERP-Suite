import { Router } from 'express';
import { healthRouter } from '../modules/health/health.routes';

/** Everything under the frozen base path `/api/v1`. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
