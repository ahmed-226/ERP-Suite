import { App, Button, Card, Drawer, Form, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, RoleInfo } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';

export default function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ roleId: string }>();

  const [editing, setEditing] = useState<AdminUser | null>(null);

  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => data.users.list() });
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: () => data.users.listRoles() });

  const assign = useMutation({
    mutationFn: (input: { userId: string; roleId: string }) =>
      data.users.assignRole(input.userId, { roleId: input.roleId }),
    onSuccess: (user) => {
      message.success(`Access updated for ${user.fullName}`);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not update access');
    },
  });

  const userColumns: ColumnsType<AdminUser> = [
    { title: 'Email', dataIndex: 'email', width: 240 },
    { title: 'Name', dataIndex: 'fullName' },
    {
      title: 'Roles',
      dataIndex: 'roles',
      render: (roles: RoleInfo[]) =>
        roles.length > 0 ? (
          <Space wrap>
            {roles.map((role) => (
              <Tag key={role.roleId} color="blue">
                {role.name}
              </Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">No role assigned</Typography.Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      width: 100,
      render: (active: boolean) => (active ? <Tag color="green">Active</Tag> : <Tag>Disabled</Tag>),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, user) => (
        <Button
          size="small"
          onClick={() => {
            setEditing(user);
            form.setFieldsValue({ roleId: user.roles[0]?.roleId });
          }}
        >
          Manage access
        </Button>
      ),
    },
  ];

  const roleColumns: ColumnsType<RoleInfo> = [
    { title: 'Code', dataIndex: 'code', width: 160 },
    { title: 'Name', dataIndex: 'name', width: 180 },
    {
      title: 'Permissions',
      dataIndex: 'permissions',
      render: (permissions: string[]) => (
        <Space wrap size={[4, 4]}>
          {permissions.map((permission) => (
            <Tag key={permission}>{permission}</Tag>
          ))}
        </Space>
      ),
    },
  ];

  const roleOptions = (rolesQ.data ?? []).map((role) => ({
    value: role.roleId,
    label: `${role.name} (${role.code})`,
  }));

  return (
    <>
      <PageHeader
        title="Users & Roles"
        subtitle="Who can sign in, and what they may do. Permissions are grouped into roles."
      />

      <Card title="Users" size="small" style={{ marginBottom: 16 }}>
        <Table<AdminUser>
          rowKey="userId"
          loading={usersQ.isLoading}
          columns={userColumns}
          dataSource={usersQ.data ?? []}
          pagination={false}
          locale={{ emptyText: 'No users' }}
        />
      </Card>

      <Card title="Roles" size="small">
        <Table<RoleInfo>
          rowKey="roleId"
          loading={rolesQ.isLoading}
          columns={roleColumns}
          dataSource={rolesQ.data ?? []}
          pagination={false}
          locale={{ emptyText: 'No roles' }}
        />
      </Card>

      <Drawer
        title={editing ? `Access — ${editing.fullName}` : 'Access'}
        width={380}
        open={editing !== null}
        destroyOnClose
        onClose={() => setEditing(null)}
      >
        <Form form={form} layout="vertical" onFinish={(values) => {
          if (editing) assign.mutate({ userId: editing.userId, roleId: values.roleId });
        }}>
          <Form.Item name="roleId" label="Role" rules={[{ required: true, message: 'Pick a role' }]}>
            <Select placeholder="Role" options={roleOptions} loading={rolesQ.isLoading} />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            The role decides which menus and actions this user sees. One role per user in v1.
          </Typography.Paragraph>
          <Space>
            <Button type="primary" htmlType="submit" loading={assign.isPending}>
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </Space>
        </Form>
      </Drawer>
    </>
  );
}
