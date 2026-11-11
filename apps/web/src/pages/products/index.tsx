import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProductInput, Product } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatQuantity } from '@/lib/format';

interface ProductFormValues {
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  reorderThreshold: number;
  isActive: boolean;
}

type DrawerMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; product: Product };

export default function ProductsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const can = usePermission();
  const [form] = Form.useForm<ProductFormValues>();

  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });

  const productsQ = useQuery({
    queryKey: ['products', { search }],
    queryFn: () => data.products.list({ search: search || undefined }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const save = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const input: CreateProductInput = {
        sku: values.sku.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || null,
        unitOfMeasure: values.unitOfMeasure.trim() || 'PCS',
        reorderThreshold: values.reorderThreshold,
        isActive: values.isActive,
      };
      return drawer.kind === 'edit'
        ? data.products.update(drawer.product.productId, input)
        : data.products.create(input);
    },
    onSuccess: () => {
      message.success(drawer.kind === 'edit' ? 'Product updated' : 'Product created');
      invalidate();
      setDrawer({ kind: 'closed' });
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not save the product');
    },
  });

  const remove = useMutation({
    mutationFn: (productId: string) => data.products.remove(productId),
    onSuccess: () => {
      message.success('Product deleted');
      invalidate();
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not delete the product');
    },
  });

  const openDrawer = (mode: DrawerMode) => {
    setDrawer(mode);
    if (mode.kind === 'edit') {
      form.setFieldsValue({
        sku: mode.product.sku,
        name: mode.product.name,
        description: mode.product.description ?? undefined,
        unitOfMeasure: mode.product.unitOfMeasure,
        reorderThreshold: mode.product.reorderThreshold,
        isActive: mode.product.isActive,
      });
    } else {
      form.setFieldsValue({ unitOfMeasure: 'PCS', reorderThreshold: 10, isActive: true, sku: '', name: '' });
    }
  };

  const columns: ColumnsType<Product> = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: 'Name', dataIndex: 'name' },
    { title: 'UoM', dataIndex: 'unitOfMeasure', width: 80 },
    {
      title: 'Reorder at',
      dataIndex: 'reorderThreshold',
      width: 110,
      align: 'right',
      render: (value: number) => formatQuantity(value),
    },
    {
      title: 'Active',
      dataIndex: 'isActive',
      width: 90,
      render: (active: boolean) => (active ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>),
    },
  ];

  if (can('products:write')) {
    columns.push({
      title: '',
      key: 'actions',
      width: 150,
      render: (_, product) => (
        <Space>
          <Button size="small" onClick={() => openDrawer({ kind: 'edit', product })}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this product?"
            description="Products with stock or movement history cannot be deleted."
            onConfirm={() => remove.mutate(product.productId)}
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
        title="Products"
        subtitle="Item catalog with SKUs and reorder thresholds."
        extra={
          can('products:write') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer({ kind: 'create' })}>
              New product
            </Button>
          ) : undefined
        }
      />

      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search SKU or name"
          allowClear
          style={{ width: 260 }}
          onSearch={(value) => setSearch(value)}
        />
      </Space>

      <Table<Product>
        rowKey="productId"
        loading={productsQ.isLoading}
        columns={columns}
        dataSource={productsQ.data ?? []}
        locale={{ emptyText: 'No products yet' }}
      />

      <Drawer
        title={drawer.kind === 'edit' ? 'Edit product' : 'New product'}
        width={420}
        open={drawer.kind !== 'closed'}
        destroyOnClose
        onClose={() => setDrawer({ kind: 'closed' })}
      >
        <Form<ProductFormValues>
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item name="sku" label="SKU" rules={[{ required: true, message: 'Enter a SKU' }]}>
            <Input placeholder="e.g. SKU-1001" maxLength={50} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="e.g. Wireless Mouse" maxLength={150} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item name="unitOfMeasure" label="Unit of measure" rules={[{ required: true }]}>
            <Select
              options={['PCS', 'BOX', 'KG', 'LTR', 'MTR'].map((u) => ({ value: u, label: u }))}
            />
          </Form.Item>
          <Form.Item name="reorderThreshold" label="Reorder threshold" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
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
