import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppShell } from '@/layouts/AppShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/Dashboard';
import PlaceholderPage from '@/pages/Placeholder';
import AccountsPage from '@/pages/accounts';
import ProductsPage from '@/pages/products';
import WarehousesPage from '@/pages/warehouses';
import JournalsPage from '@/pages/journals';
import JournalEditorPage from '@/pages/journals/JournalEditorPage';
import JournalDetailPage from '@/pages/journals/JournalDetailPage';
import TrialBalancePage from '@/pages/trialBalance';
import AccountLedgerPage from '@/pages/ledger';
import ProfitAndLossPage from '@/pages/profitAndLoss';
import BalanceSheetPage from '@/pages/balanceSheet';
import CashFlowPage from '@/pages/cashFlow';
import InventoryValuationPage from '@/pages/inventoryValuation';
import StockPage from '@/pages/stock';
import MovementsPage from '@/pages/movements';
import InventoryOperationsPage from '@/pages/operations';
import StocktakesPage from '@/pages/stocktakes';
import FiscalPeriodsPage from '@/pages/fiscal';
import SettingsPage from '@/pages/settings';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      {
        path: 'accounting/accounts',
        element: <AccountsPage />,
      },
      {
        path: 'accounting/journals',
        element: <JournalsPage />,
      },
      {
        path: 'accounting/journals/new',
        element: <JournalEditorPage />,
      },
      {
        path: 'accounting/journals/:entryId',
        element: <JournalDetailPage />,
      },
      {
        path: 'accounting/journals/:entryId/edit',
        element: <JournalEditorPage />,
      },
      {
        path: 'accounting/trial-balance',
        element: <TrialBalancePage />,
      },
      {
        path: 'accounting/ledger/:accountId',
        element: <AccountLedgerPage />,
      },
      {
        path: 'accounting/profit-and-loss',
        element: <ProfitAndLossPage />,
      },
      {
        path: 'accounting/balance-sheet',
        element: <BalanceSheetPage />,
      },
      {
        path: 'accounting/cash-flow',
        element: <CashFlowPage />,
      },
      {
        path: 'accounting/fiscal-periods',
        element: <FiscalPeriodsPage />,
      },

      {
        path: 'inventory/products',
        element: <ProductsPage />,
      },
      {
        path: 'inventory/warehouses',
        element: <WarehousesPage />,
      },
      {
        path: 'inventory/stock',
        element: <StockPage />,
      },
      {
        path: 'inventory/movements',
        element: <MovementsPage />,
      },
      {
        path: 'inventory/operations',
        element: <InventoryOperationsPage />,
      },
      {
        path: 'inventory/valuation',
        element: <InventoryValuationPage />,
      },
      {
        path: 'inventory/stocktakes',
        element: <StocktakesPage />,
      },

      {
        path: 'settings/access',
        element: <SettingsPage />,
      },

      { path: '*', element: <PlaceholderPage title="Page not found" phase="—" /> },
    ],
  },
]);
