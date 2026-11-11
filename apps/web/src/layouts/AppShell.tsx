import {
  AppstoreOutlined,
  BankOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  InboxOutlined,
  ProfileOutlined,
  SettingOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { dataSourceKind } from '@/data/client';

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  {
    key: 'accounting',
    icon: <BankOutlined />,
    label: 'Accounting',
    children: [
      { key: '/accounting/accounts', icon: <ProfileOutlined />, label: 'Chart of Accounts' },
      { key: '/accounting/journals', icon: <BookOutlined />, label: 'Journal Entries' },
      { key: '/accounting/trial-balance', icon: <DatabaseOutlined />, label: 'Trial Balance' },
    ],
  },
  {
    key: 'inventory',
    icon: <AppstoreOutlined />,
    label: 'Inventory',
    children: [
      { key: '/inventory/products', icon: <AppstoreOutlined />, label: 'Products' },
      { key: '/inventory/warehouses', icon: <InboxOutlined />, label: 'Warehouses' },
      { key: '/inventory/stock', icon: <DatabaseOutlined />, label: 'Stock Levels' },
      { key: '/inventory/movements', icon: <SwapOutlined />, label: 'Movements' },
      { key: '/inventory/operations', icon: <SwapOutlined />, label: 'Operations' },
    ],
  },
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: 'Settings',
    children: [{ key: '/settings/access', icon: <SettingOutlined />, label: 'Users & Roles' }],
  },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = location.pathname === '/' ? '/dashboard' : location.pathname;

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
          <Typography.Text strong>Acme Trading Co.</Typography.Text>
          <Space>
            <Tag color={dataSourceKind === 'mock' ? 'gold' : 'green'}>
              data: {dataSourceKind}
            </Tag>
            <Typography.Text type="secondary">Not signed in</Typography.Text>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
