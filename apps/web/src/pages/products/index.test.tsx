import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import ProductsPage from './index';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  productsList: vi.fn(),
}));

vi.mock('@/data/client', () => ({
  dataSourceKind: 'mock',
  data: {
    auth: { me: mocks.me },
    products: { list: mocks.productsList },
  },
}));

const adminUser = {
  userId: 'u1',
  companyId: 'c1',
  companyName: 'Acme Trading Co.',
  email: 'admin@acme.test',
  fullName: 'Alice Admin',
  roles: ['ADMIN'],
  permissions: ['products:read', 'products:write'],
};

function makeProduct(overrides: Partial<{ sku: string; name: string }>) {
  return {
    productId: `p-${overrides.sku}`,
    companyId: 'c1',
    sku: 'SKU-0000',
    name: 'Product',
    description: null,
    unitOfMeasure: 'PCS',
    reorderThreshold: 10,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AntApp>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/inventory/products']}>
            <Routes>
              <Route path="/inventory/products" element={<ProductsPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </AntApp>,
  );
}

beforeEach(() => {
  mocks.me.mockReset();
  mocks.productsList.mockReset();
  mocks.me.mockResolvedValue(adminUser);
  localStorage.clear();
});

describe('ProductsPage', () => {
  it('lists products returned by the data source', async () => {
    mocks.productsList.mockResolvedValue([
      makeProduct({ sku: 'SKU-1001', name: 'Wireless Mouse' }),
      makeProduct({ sku: 'SKU-1002', name: 'Mechanical Keyboard' }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText('SKU-1001')).toBeInTheDocument());
    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
  });

  it('shows an empty state when there are no products', async () => {
    mocks.productsList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('No products yet')).toBeInTheDocument());
  });
});
