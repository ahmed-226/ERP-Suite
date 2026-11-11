import { Router } from 'express';
import { accountRouter } from '../modules/accounts/accounts.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { healthRouter } from '../modules/health/health.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { journalRouter } from '../modules/journals/journals.routes';
import { productRouter } from '../modules/products/products.routes';
import { reportRouter } from '../modules/reports/reports.routes';
import { userRouter } from '../modules/users/users.routes';
import { warehouseRouter } from '../modules/warehouses/warehouses.routes';

/** Everything under the frozen base path `/api/v1`. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/accounts', accountRouter);
apiRouter.use('/journals', journalRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/warehouses', warehouseRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/users', userRouter);
