import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import JournalEditorPage from './JournalEditorPage';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  accountsList: vi.fn(),
  journalGet: vi.fn(),
}));

vi.mock('@/data/client', () => ({
  dataSourceKind: 'mock',
  data: {
    auth: { me: mocks.me },
    accounts: { list: mocks.accountsList },
    journals: { get: mocks.journalGet },
  },
}));

const adminUser = {
  userId: 'u1',
  companyId: 'c1',
  companyName: 'Acme Trading Co.',
  email: 'admin@acme.test',
  fullName: 'Alice Admin',
  roles: ['ADMIN'],
  permissions: [
    'accounts:read',
    'journals:read',
    'journals:write',
    'journals:post',
  ],
};

const accounts = [
  {
    accountId: 'a-cash',
    companyId: 'c1',
    accountCode: '1000',
    accountName: 'Cash and Bank',
    accountType: 'ASSET',
    parentAccountId: null,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    accountId: 'a-cogs',
    companyId: 'c1',
    accountCode: '5000',
    accountName: 'Cost of Goods Sold',
    accountType: 'EXPENSE',
    parentAccountId: null,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
  },
];

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AntApp>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/accounting/journals/new']}>
            <Routes>
              <Route path="/accounting/journals/new" element={<JournalEditorPage />} />
              <Route path="/accounting/journals" element={<div>journals-list</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </AntApp>,
  );
}

beforeEach(() => {
  mocks.me.mockReset();
  mocks.accountsList.mockReset();
  mocks.journalGet.mockReset();
  mocks.me.mockResolvedValue(adminUser);
  mocks.accountsList.mockResolvedValue(accounts);
  localStorage.clear();
});

describe('JournalEditorPage balance indicator', () => {
  it('shows the out-of-balance difference while lines disagree', async () => {
    const { container } = renderEditor();

    await waitFor(() =>
      expect(screen.getByTestId('balance-indicator')).toHaveTextContent('No amounts yet'),
    );

    const amountInputs = container.querySelectorAll<HTMLInputElement>(
      'input.ant-input-number-input',
    );
    expect(amountInputs.length).toBe(2);

    fireEvent.change(amountInputs[0], { target: { value: '100' } });
    fireEvent.change(amountInputs[1], { target: { value: '40' } });

    await waitFor(() =>
      expect(screen.getByTestId('balance-indicator')).toHaveTextContent(
        'Out of balance by 60.00',
      ),
    );
  });

  it('turns green when debits equal credits', async () => {
    const { container } = renderEditor();

    await waitFor(() => expect(mocks.accountsList).toHaveBeenCalled());

    const amountInputs = container.querySelectorAll<HTMLInputElement>(
      'input.ant-input-number-input',
    );
    fireEvent.change(amountInputs[0], { target: { value: '250.50' } });
    fireEvent.change(amountInputs[1], { target: { value: '250.50' } });

    await waitFor(() =>
      expect(screen.getByTestId('balance-indicator')).toHaveTextContent('Balanced'),
    );
  });
});
