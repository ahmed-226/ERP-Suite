import { CheckCircleOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CreateStocktakeInput, Stocktake, StocktakeLine } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatDateTime, formatQuantity } from '@/lib/format';

function errorMessage(error: unknown): string {
  return isDataError(error) ? error.message : 'The operation failed';
}

function StatusTag({ status }: { status: Stocktake['status'] }) {
  const color = status === 'APPLIED' ? 'green' : status === 'CANCELLED' ? 'default' : 'blue';
  return <Tag color={color}>{status}</Tag>;
}

function CreateStocktakeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateStocktakeInput & { warehouseId: string }>();
  const queryClient = useQueryClient();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | undefined>();

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => data.warehouses.list({ active: true }),
    enabled: open,
  });
  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: () => data.products.list({ active: true }),
    enabled: open,
  });
  const stockQ = useQuery({
    queryKey: ['stock', { warehouseId: selectedWarehouseId }],
    queryFn: () => data.inventory.stock({ warehouseId: selectedWarehouseId }),
    enabled: open && !!selectedWarehouseId,
  });

  const create = useMutation({
    mutationFn: (input: CreateStocktakeInput) => data.inventory.createStocktake(input),
    onSuccess: () => {
      message.success('Stocktake count sheet created');
      void queryClient.invalidateQueries({ queryKey: ['stocktakes'] });
      form.resetFields();
      setSelectedWarehouseId(undefined);
      onClose();
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  const onWarehouseChange = (warehouseId: string) => {
    setSelectedWarehouseId(warehouseId);
    // Prefill lines with products that currently have stock in this warehouse.
    // User can edit counted quantities; products with zero on-hand can be added by editing if needed.
  };

  const stockRows = stockQ.data ?? [];
  const productOptions = (productsQ.data ?? []).map((p) => ({
    value: p.productId,
    label: `${p.sku} — ${p.name}`,
  }));

  const prefillFromStock = () => {
    const lines = stockRows.map((s) => ({
      productId: s.productId,
      countedQuantity: s.quantityOnHand,
    }));
    form.setFieldValue('lines', lines);
  };

  return (
    <Modal
      title="New stocktake count"
      open={open}
      onCancel={() => {
        form.resetFields();
        setSelectedWarehouseId(undefined);
        onClose();
      }}
      onOk={() => form.submit()}
      okText="Create count sheet"
      confirmLoading={create.isPending}
      width={760}
      destroyOnClose
    >
      <Form<CreateStocktakeInput>
        form={form}
        layout="vertical"
        onFinish={(values) => create.mutate(values)}
        initialValues={{ lines: [] }}
      >
        <Form.Item
          name="warehouseId"
          label="Warehouse"
          rules={[{ required: true, message: 'Select a warehouse' }]}
        >
          <Select
            placeholder="Warehouse"
            options={(warehousesQ.data ?? []).map((w) => ({
              value: w.warehouseId,
              label: `${w.code} — ${w.name}`,
            }))}
            onChange={onWarehouseChange}
          />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} maxLength={500} placeholder="Optional notes" />
        </Form.Item>

        <Space style={{ marginBottom: 8 }}>
          <Button
            onClick={prefillFromStock}
            disabled={!selectedWarehouseId || stockQ.isLoading}
          >
            Prefill from current stock
          </Button>
          <Typography.Text type="secondary">
            System quantities are captured at creation for each counted line.
          </Typography.Text>
        </Space>

        <Form.List
          name="lines"
          rules={[
            {
              validator: async (_, lines) => {
                if (!lines || lines.length < 1) {
                  throw new Error('Add at least one counted product line');
                }
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              <Table
                size="small"
                pagination={false}
                dataSource={fields}
                rowKey="key"
                locale={{ emptyText: selectedWarehouseId ? 'Add lines or prefill from stock' : 'Select a warehouse first' }}
                columns={[
                  {
                    title: 'Product',
                    render: (_, field) => (
                      <Form.Item
                        name={[field.name, 'productId']}
                        rules={[{ required: true, message: 'Select product' }]}
                        style={{ margin: 0 }}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Product"
                          options={productOptions}
                          style={{ minWidth: 320 }}
                        />
                      </Form.Item>
                    ),
                  },
                  {
                    title: 'Counted qty',
                    width: 160,
                    render: (_, field) => (
                      <Form.Item
                        name={[field.name, 'countedQuantity']}
                        rules={[{ required: true, message: 'Required' }]}
                        style={{ margin: 0 }}
                      >
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '',
                    width: 60,
                    render: (_, field) => (
                      <Button danger type="link" onClick={() => remove(field.name)}>
                        Remove
                      </Button>
                    ),
                  },
                ]}
                footer={() => (
                  <Button type="dashed" onClick={() => add()} block disabled={!selectedWarehouseId}>
                    Add product line
                  </Button>
                )}
              />
              <Form.ErrorList errors={errors} />
            </>
          )}
        </Form.List>

        {create.isError ? (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message={errorMessage(create.error)} />
        ) : null}
      </Form>
    </Modal>
  );
}

export default function StocktakesPage() {
  const { message } = App.useApp();
  const can = usePermission();
  const canWrite = can('inventory:write');
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState<string | undefined>();

  const stocktakesQ = useQuery({
    queryKey: ['stocktakes', warehouseFilter],
    queryFn: () => data.inventory.stocktakes(warehouseFilter),
  });
  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => data.warehouses.list(),
  });

  const applyM = useMutation({
    mutationFn: (id: string) => data.inventory.applyStocktake(id),
    onSuccess: () => {
      message.success('Stocktake applied: adjustment movements and GL postings created for variances');
      void queryClient.invalidateQueries({ queryKey: ['stocktakes'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  const selected = (stocktakesQ.data ?? []).find((s) => s.stocktakeId === viewId) ?? null;

  const columns: ColumnsType<Stocktake> = [
    { title: 'Warehouse', dataIndex: 'warehouseCode', width: 120 },
    { title: 'Warehouse name', dataIndex: 'warehouseName' },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (s: Stocktake['status']) => <StatusTag status={s} />,
    },
    {
      title: 'Lines',
      key: 'lines',
      width: 80,
      align: 'right',
      render: (_, r) => r.lines.length,
    },
    {
      title: 'Variance lines',
      key: 'variance',
      width: 130,
      align: 'right',
      render: (_, r) => r.lines.filter((l) => l.variance !== 0).length,
    },
    { title: 'Created', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
    { title: 'By', dataIndex: 'createdByName', width: 140 },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewId(r.stocktakeId)}>
            View
          </Button>
          {canWrite && r.status === 'DRAFT' ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={applyM.isPending && applyM.variables === r.stocktakeId}
              onClick={() =>
                Modal.confirm({
                  title: 'Apply stocktake?',
                  content:
                    'This will create adjustment movements and GL postings for all variances. It cannot be undone.',
                  okText: 'Apply',
                  onOk: () => applyM.mutateAsync(r.stocktakeId),
                })
              }
            >
              Apply
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const lineColumns: ColumnsType<StocktakeLine> = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: 'Product', dataIndex: 'productName' },
    { title: 'System', dataIndex: 'systemQuantity', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
    { title: 'Counted', dataIndex: 'countedQuantity', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
    {
      title: 'Variance',
      dataIndex: 'variance',
      width: 110,
      align: 'right',
      render: (v: number) => (
        <Typography.Text type={v < 0 ? 'danger' : v > 0 ? 'success' : undefined} strong={v !== 0}>
          {v > 0 ? `+${formatQuantity(v)}` : formatQuantity(v)}
        </Typography.Text>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stocktakes / Cycle Counts"
        subtitle="Count sheets per warehouse with auditable variances. Applying creates adjustment movements and GL postings."
        extra={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              New count
            </Button>
          ) : undefined
        }
      />

      {isDataError(stocktakesQ.error) ? (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={stocktakesQ.error.message} />
      ) : null}

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Space>
          <Select
            allowClear
            placeholder="Filter by warehouse"
            style={{ width: 240 }}
            options={(warehousesQ.data ?? []).map((w) => ({ value: w.warehouseId, label: `${w.code} — ${w.name}` }))}
            value={warehouseFilter}
            onChange={setWarehouseFilter}
          />
        </Space>
      </Card>

      <Table<Stocktake>
        rowKey="stocktakeId"
        loading={stocktakesQ.isLoading}
        columns={columns}
        dataSource={stocktakesQ.data ?? []}
        locale={{ emptyText: 'No stocktakes yet' }}
      />

      <CreateStocktakeModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Drawer
        title="Stocktake details"
        open={!!viewId}
        onClose={() => setViewId(null)}
        width={720}
      >
        {selected ? (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Warehouse">
                {selected.warehouseCode} — {selected.warehouseName}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusTag status={selected.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Created by">{selected.createdByName}</Descriptions.Item>
              <Descriptions.Item label="Created at">{formatDateTime(selected.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Applied by">{selected.appliedByName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Applied at">
                {selected.appliedAt ? formatDateTime(selected.appliedAt) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Notes" span={2}>
                {selected.notes || '—'}
              </Descriptions.Item>
            </Descriptions>
            <Table<StocktakeLine>
              rowKey="lineId"
              size="small"
              pagination={false}
              columns={lineColumns}
              dataSource={selected.lines}
            />
          </>
        ) : null}
      </Drawer>
    </>
  );
}
