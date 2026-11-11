import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import DashboardPage from '@/pages/Dashboard';
import PlaceholderPage from '@/pages/Placeholder';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },

      {
        path: 'accounting/accounts',
        element: <PlaceholderPage title="Chart of Accounts" phase="A5" />,
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
        element: <PlaceholderPage title="Products" phase="A5" />,
      },
      {
        path: 'inventory/warehouses',
        element: <PlaceholderPage title="Warehouses" phase="A5" />,
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
