import {
  AppstoreOutlined,
  BankOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  InboxOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SettingOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { usePermission } from '@/auth/usePermission';

const { Header, Sider, Content } = Layout;

type MenuItems = NonNullable<MenuProps['items']>;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const can = usePermission();

  const selectedKey = location.pathname === '/' ? '/dashboard' : location.pathname;

  // Navigation reflects the signed-in user's permissions.
  const menuItems = useMemo<MenuItems>(() => {
    const dashboard: MenuItems = can('reports:read')
      ? [{ key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' }]
      : [];

    const accounting = (
      [
        can('accounts:read') && {
          key: '/accounting/accounts',
          icon: <ProfileOutlined />,
          label: 'Chart of Accounts',
        },
        can('journals:read') && {
          key: '/accounting/journals',
          icon: <BookOutlined />,
          label: 'Journal Entries',
        },
        can('reports:read') && {
          key: '/accounting/trial-balance',
          icon: <DatabaseOutlined />,
          label: 'Trial Balance',
        },
      ].filter(Boolean) as MenuItems
    );

    const inventory = (
      [
        can('products:read') && {
          key: '/inventory/products',
          icon: <AppstoreOutlined />,
          label: 'Products',
        },
        can('warehouses:read') && {
          key: '/inventory/warehouses',
          icon: <InboxOutlined />,
          label: 'Warehouses',
        },
        can('inventory:read') && {
          key: '/inventory/stock',
          icon: <DatabaseOutlined />,
          label: 'Stock Levels',
        },
        can('inventory:read') && {
          key: '/inventory/movements',
          icon: <SwapOutlined />,
          label: 'Movements',
        },
        can('inventory:read') && {
          key: '/inventory/operations',
          icon: <SwapOutlined />,
          label: 'Operations',
        },
      ].filter(Boolean) as MenuItems
    );

    const settings: MenuItems = can('users:read')
      ? [{ key: '/settings/access', icon: <SettingOutlined />, label: 'Users & Roles' }]
      : [];

    return [
      ...dashboard,
      accounting.length > 0 && {
        key: 'accounting',
        icon: <BankOutlined />,
        label: 'Accounting',
        children: accounting,
      },
      inventory.length > 0 && {
        key: 'inventory',
        icon: <AppstoreOutlined />,
        label: 'Inventory',
        children: inventory,
      },
      settings.length > 0 && {
        key: 'settings',
        icon: <SettingOutlined />,
        label: 'Settings',
        children: settings,
      },
    ].filter(Boolean) as MenuItems;
  }, [can]);

  const userMenu: MenuProps['items'] = [
    { key: 'email', label: user?.email ?? '—', disabled: true },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={230} theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            color: '#fff',
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          ERP Suite
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['accounting', 'inventory', 'settings']}
          items={menuItems}
          onClick={({ key }) => {
            if (typeof key === 'string' && key.startsWith('/')) navigate(key);
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Text strong>{user?.companyName ?? 'ERP Suite'}</Typography.Text>
          <Space>
            <Dropdown
              menu={{
                items: userMenu,
                onClick: async ({ key }) => {
                  if (key === 'logout') {
                    await logout();
                    navigate('/login');
                  }
                },
              }}
              placement="bottomRight"
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <Typography.Text>{user?.fullName ?? '—'}</Typography.Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
