import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Form, Input, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWarehouseInput, Warehouse } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';

interface WarehouseFormValues {
  code: string;
  name: string;
  locationAddress?: string;
  isActive: boolean;
}

type DrawerMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; warehouse: Warehouse };

export default function WarehousesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const can = usePermission();
  const [form] = Form.useForm<WarehouseFormValues>();

  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });

  const warehousesQ = useQuery({
    queryKey: ['warehouses', { search }],
    queryFn: () => data.warehouses.list({ search: search || undefined }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
  };

  const save = useMutation({
    mutationFn: (values: WarehouseFormValues) => {
      const input: CreateWarehouseInput = {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        locationAddress: values.locationAddress?.trim() || null,
        isActive: values.isActive,
      };
      return drawer.kind === 'edit'
        ? data.warehouses.update(drawer.warehouse.warehouseId, input)
        : data.warehouses.create(input);
    },
    onSuccess: () => {
      message.success(drawer.kind === 'edit' ? 'Warehouse updated' : 'Warehouse created');
      invalidate();
      setDrawer({ kind: 'closed' });
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not save the warehouse');
    },
  });

  const remove = useMutation({
    mutationFn: (warehouseId: string) => data.warehouses.remove(warehouseId),
    onSuccess: () => {
      message.success('Warehouse deleted');
      invalidate();
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not delete the warehouse');
    },
  });

  const openDrawer = (mode: DrawerMode) => {
    setDrawer(mode);
    if (mode.kind === 'edit') {
      form.setFieldsValue({
        code: mode.warehouse.code,
        name: mode.warehouse.name,
        locationAddress: mode.warehouse.locationAddress ?? undefined,
        isActive: mode.warehouse.isActive,
      });
    } else {
      form.setFieldsValue({ isActive: true, code: '', name: '' });
    }
  };

  const columns: ColumnsType<Warehouse> = [
    { title: 'Code', dataIndex: 'code', width: 120 },
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Location',
      dataIndex: 'locationAddress',
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'Active',
      dataIndex: 'isActive',
      width: 90,
      render: (active: boolean) => (active ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>),
    },
  ];

  if (can('warehouses:write')) {
    columns.push({
      title: '',
      key: 'actions',
      width: 150,
      render: (_, warehouse) => (
        <Space>
          <Button size="small" onClick={() => openDrawer({ kind: 'edit', warehouse })}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this warehouse?"
            description="Warehouses holding stock or with movement history cannot be deleted."
            onConfirm={() => remove.mutate(warehouse.warehouseId)}
          >
            <Button size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="Stock-keeping locations."
        extra={
          can('warehouses:write') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer({ kind: 'create' })}>
              New warehouse
            </Button>
          ) : undefined
        }
      />

      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search code or name"
          allowClear
          style={{ width: 260 }}
          onSearch={(value) => setSearch(value)}
        />
      </Space>

      <Table<Warehouse>
        rowKey="warehouseId"
        loading={warehousesQ.isLoading}
        columns={columns}
        dataSource={warehousesQ.data ?? []}
        locale={{ emptyText: 'No warehouses yet' }}
      />

      <Drawer
        title={drawer.kind === 'edit' ? 'Edit warehouse' : 'New warehouse'}
        width={420}
        open={drawer.kind !== 'closed'}
        destroyOnClose
        onClose={() => setDrawer({ kind: 'closed' })}
      >
        <Form<WarehouseFormValues>
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item name="code" label="Code" rules={[{ required: true, message: 'Enter a code' }]}>
            <Input placeholder="e.g. MAIN" maxLength={20} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="e.g. Main Warehouse" maxLength={100} />
          </Form.Item>
          <Form.Item name="locationAddress" label="Location address">
            <Input.TextArea rows={2} maxLength={500} />
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
      </Drawer>
    </>
  );
}
