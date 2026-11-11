import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
}));

vi.mock('@/data/client', () => ({
  data: {
    auth: {
      me: mocks.me,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    },
  },
}));

function renderGuard() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>login-page</div>} />
          <Route
            path="/protected"
            element={
              <RequireAuth>
                <div>protected-content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mocks.me.mockReset();
  localStorage.clear();
});

describe('RequireAuth', () => {
  it('redirects anonymous visitors to the login page', async () => {
    mocks.me.mockRejectedValue(new Error('Not signed in'));
    renderGuard();

    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument());
    expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
  });

  it('renders protected content for a signed-in user', async () => {
    mocks.me.mockResolvedValue({
      userId: 'u1',
      companyId: 'c1',
      companyName: 'Acme Trading Co.',
      email: 'admin@acme.test',
      fullName: 'Alice Admin',
      roles: ['ADMIN'],
      permissions: ['accounts:read'],
    });
    renderGuard();

    await waitFor(() => expect(screen.getByText('protected-content')).toBeInTheDocument());
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
  });
});
