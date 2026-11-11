import { Router } from 'express';
import { accountRouter } from '../modules/accounts/accounts.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { productRouter } from '../modules/products/products.routes';
import { userRouter } from '../modules/users/users.routes';
import { warehouseRouter } from '../modules/warehouses/warehouses.routes';

/** Everything under the frozen base path `/api/v1`. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/accounts', accountRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/warehouses', warehouseRouter);
apiRouter.use('/users', userRouter);
