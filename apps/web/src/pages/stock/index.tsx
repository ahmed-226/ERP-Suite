import { Alert, Card, Checkbox, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InventoryStock } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatDateTime, formatQuantity } from '@/lib/format';

interface StockFilterState {
  productId?: string;
  warehouseId?: string;
  lowStock?: boolean;
}

export default function StockPage() {
  const [filter, setFilter] = useState<StockFilterState>({});

  const stockQ = useQuery({
    queryKey: ['stock', filter],
    queryFn: () => data.inventory.stock(filter),
  });
  const productsQ = useQuery({ queryKey: ['products'], queryFn: () => data.products.list() });
  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => data.warehouses.list(),
  });

  const columns: ColumnsType<InventoryStock> = [
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: 'Product', dataIndex: 'productName' },
    { title: 'Warehouse', dataIndex: 'warehouseCode', width: 130 },
    {
      title: 'On hand',
      dataIndex: 'quantityOnHand',
      width: 110,
      align: 'right',
      render: (value: number, row) => (
        <Typography.Text type={row.isLowStock ? 'danger' : undefined}>
          {formatQuantity(value)}
        </Typography.Text>
      ),
    },
    {
      title: 'Reserved',
      dataIndex: 'quantityReserved',
      width: 110,
      align: 'right',
      render: (value: number) => formatQuantity(value),
    },
    {
      title: 'Reorder at',
      dataIndex: 'reorderThreshold',
      width: 110,
      align: 'right',
      render: (value: number) => formatQuantity(value),
    },
    {
      title: 'Status',
      dataIndex: 'isLowStock',
      width: 100,
      render: (low: boolean) =>
        low ? <Tag color="red">Low</Tag> : <Tag color="green">OK</Tag>,
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock Levels"
        subtitle="Quantity on hand per product and warehouse, with reorder thresholds."
      />

      {isDataError(stockQ.error) ? (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={stockQ.error.message} />
      ) : null}

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="Product"
            style={{ width: 240 }}
            showSearch
            optionFilterProp="label"
            options={(productsQ.data ?? []).map((p) => ({
              value: p.productId,
              label: `${p.sku} — ${p.name}`,
            }))}
            value={filter.productId}
            onChange={(value) => setFilter((f) => ({ ...f, productId: value }))}
          />
          <Select
            allowClear
            placeholder="Warehouse"
            style={{ width: 200 }}
            options={(warehousesQ.data ?? []).map((w) => ({
              value: w.warehouseId,
              label: `${w.code} — ${w.name}`,
            }))}
            value={filter.warehouseId}
            onChange={(value) => setFilter((f) => ({ ...f, warehouseId: value }))}
          />
          <Checkbox
            checked={filter.lowStock ?? false}
            onChange={(e) => setFilter((f) => ({ ...f, lowStock: e.target.checked || undefined }))}
          >
            Low stock only
          </Checkbox>
        </Space>
      </Card>

      <Table<InventoryStock>
        rowKey="stockId"
        loading={stockQ.isLoading}
        columns={columns}
        dataSource={stockQ.data ?? []}
        locale={{ emptyText: 'No stock records match the filters' }}
      />
    </>
  );
}
