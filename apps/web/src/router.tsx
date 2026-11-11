import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppShell } from '@/layouts/AppShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/Dashboard';
import PlaceholderPage from '@/pages/Placeholder';
import AccountsPage from '@/pages/accounts';
import ProductsPage from '@/pages/products';
import WarehousesPage from '@/pages/warehouses';

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
        element: <PlaceholderPage title="Journal Entries" phase="A6" />,
      },
      {
        path: 'accounting/trial-balance',
        element: <PlaceholderPage title="Trial Balance" phase="A6" />,
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
        element: <PlaceholderPage title="Stock Levels" phase="A7" />,
      },
      {
        path: 'inventory/movements',
        element: <PlaceholderPage title="Inventory Movements" phase="A7" />,
      },
      {
        path: 'inventory/operations',
        element: <PlaceholderPage title="Inventory Operations" phase="A7" />,
      },

      {
        path: 'settings/access',
        element: <PlaceholderPage title="Users & Roles" phase="A8" />,
      },

      { path: '*', element: <PlaceholderPage title="Page not found" phase="—" /> },
    ],
  },
]);
