import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Form, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACCOUNT_TYPES,
  type Account,
  type AccountType,
  type CreateAccountInput,
} from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { ACCOUNT_TYPE_COLORS } from '@/lib/format';

interface AccountFormValues {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId?: string;
  isActive: boolean;
}

type DrawerMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; account: Account };

export default function AccountsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const can = usePermission();
  const [form] = Form.useForm<AccountFormValues>();

  const [typeFilter, setTypeFilter] = useState<AccountType | undefined>();
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });

  const accountsQ = useQuery({
    queryKey: ['accounts', { type: typeFilter }],
    queryFn: () => data.accounts.list({ type: typeFilter }),
  });

  const treeData = useMemo(() => {
    interface BuildNode extends Account {
      children: BuildNode[];
    }
    interface TreeNode extends Account {
      children?: TreeNode[];
    }
    const nodes = new Map(
      accountsQ.data?.map((a) => [a.accountId, { ...a, children: [] as BuildNode[] }]),
    );
    const roots: BuildNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentAccountId ? nodes.get(node.parentAccountId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const clean = (node: BuildNode): TreeNode => ({
      ...node,
      children: node.children.length ? node.children.map(clean) : undefined,
    });
    return roots.sort((a, b) => a.accountCode.localeCompare(b.accountCode)).map(clean);
  }, [accountsQ.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const save = useMutation({
    mutationFn: (values: AccountFormValues) => {
      const input: CreateAccountInput = {
        accountCode: values.accountCode.trim(),
        accountName: values.accountName.trim(),
        accountType: values.accountType,
        parentAccountId: values.parentAccountId ?? null,
        isActive: values.isActive,
      };
      return drawer.kind === 'edit'
        ? data.accounts.update(drawer.account.accountId, input)
        : data.accounts.create(input);
    },
    onSuccess: () => {
      message.success(drawer.kind === 'edit' ? 'Account updated' : 'Account created');
      invalidate();
      setDrawer({ kind: 'closed' });
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not save the account');
    },
  });

  const remove = useMutation({
    mutationFn: (accountId: string) => data.accounts.remove(accountId),
    onSuccess: () => {
      message.success('Account deleted');
      invalidate();
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not delete the account');
    },
  });

  const openDrawer = (mode: DrawerMode) => {
    setDrawer(mode);
    if (mode.kind === 'edit') {
      form.setFieldsValue({
        accountCode: mode.account.accountCode,
        accountName: mode.account.accountName,
        accountType: mode.account.accountType,
        parentAccountId: mode.account.parentAccountId ?? undefined,
        isActive: mode.account.isActive,
      });
    } else {
      form.setFieldsValue({ accountType: 'ASSET', isActive: true, accountCode: '', accountName: '' });
    }
  };

  const columns: ColumnsType<Account> = [
    { title: 'Code', dataIndex: 'accountCode', width: 120 },
    { title: 'Name', dataIndex: 'accountName' },
    {
      title: 'Type',
      dataIndex: 'accountType',
      width: 120,
      render: (type: AccountType) => <Tag color={ACCOUNT_TYPE_COLORS[type]}>{type}</Tag>,
    },
    {
      title: 'Active',
      dataIndex: 'isActive',
      width: 90,
      render: (active: boolean) => (active ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>),
    },
  ];

  if (can('accounts:write')) {
    columns.push({
      title: '',
      key: 'actions',
      width: 150,
      render: (_, account) => (
        <Space>
          <Button size="small" onClick={() => openDrawer({ kind: 'edit', account })}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this account?"
            description="Accounts used by entries cannot be deleted."
            onConfirm={() => remove.mutate(account.accountId)}
          >
            <Button size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    });
  }

  const parentOptions = (accountsQ.data ?? [])
    .filter((a) => drawer.kind !== 'edit' || a.accountId !== drawer.account.accountId)
    .map((a) => ({ value: a.accountId, label: `${a.accountCode} — ${a.accountName}` }));

  return (
    <>
      <PageHeader
        title="Chart of Accounts"
        subtitle="Ledger accounts organized as a parent/child hierarchy."
        extra={
          can('accounts:write') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer({ kind: 'create' })}>
              New account
            </Button>
          ) : undefined
        }
      />

      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter by type"
          style={{ width: 180 }}
          options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))}
          value={typeFilter}
          onChange={(value) => setTypeFilter(value)}
        />
      </Space>

      <Table<Account>
        rowKey="accountId"
        loading={accountsQ.isLoading}
        columns={columns}
        dataSource={treeData}
        pagination={false}
        locale={{ emptyText: 'No accounts yet' }}
      />

      <Drawer
        title={drawer.kind === 'edit' ? 'Edit account' : 'New account'}
        width={420}
        open={drawer.kind !== 'closed'}
        destroyOnClose
        onClose={() => setDrawer({ kind: 'closed' })}
      >
        <Form<AccountFormValues>
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item name="accountCode" label="Code" rules={[{ required: true, message: 'Enter a code' }]}>
            <Input placeholder="e.g. 1010" maxLength={30} />
          </Form.Item>
          <Form.Item name="accountName" label="Name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="e.g. Petty Cash" maxLength={100} />
          </Form.Item>
          <Form.Item name="accountType" label="Type" rules={[{ required: true }]}>
            <Select options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="parentAccountId" label="Parent account">
            <Select
              allowClear
              placeholder="None (top-level account)"
              options={parentOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              Save
            </Button>
            <Button onClick={() => setDrawer({ kind: 'closed' })}>Cancel</Button>
          </Space>
        </Form>
        {drawer.kind === 'edit' ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Accounts referenced by journal entries cannot be deleted.
          </Typography.Paragraph>
        ) : null}
      </Drawer>
    </>
  );
}
