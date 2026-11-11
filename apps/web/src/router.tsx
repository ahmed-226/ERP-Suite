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
import TrialBalancePage from '@/pages/trialBalance';
import StockPage from '@/pages/stock';
import MovementsPage from '@/pages/movements';
import InventoryOperationsPage from '@/pages/operations';
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
        path: 'accounting/journals/:entryId/edit',
        element: <JournalEditorPage />,
      },
      {
        path: 'accounting/trial-balance',
        element: <TrialBalancePage />,
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
        path: 'settings/access',
        element: <SettingsPage />,
      },

      { path: '*', element: <PlaceholderPage title="Page not found" phase="—" /> },
    ],
  },
]);
