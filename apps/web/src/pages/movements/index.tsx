import { Alert, Card, DatePicker, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { MOVEMENT_TYPES, type InventoryTransaction, type MovementType } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { MOVEMENT_TYPE_LABELS, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';

interface MovementFilterState {
  productId?: string;
  warehouseId?: string;
  movementType?: MovementType;
  from?: string;
  to?: string;
}

export default function MovementsPage() {
  const [type, setType] = useState<MovementType | undefined>();
  const [productId, setProductId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const filter = useMemo<MovementFilterState>(
    () => ({
      movementType: type,
      productId,
      warehouseId,
      from: range?.[0].format('YYYY-MM-DD'),
      to: range?.[1].format('YYYY-MM-DD'),
    }),
    [type, productId, warehouseId, range],
  );

  const movementsQ = useQuery({
    queryKey: ['movements', filter],
    queryFn: () => data.inventory.movements(filter),
  });
  const productsQ = useQuery({ queryKey: ['products'], queryFn: () => data.products.list() });
  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => data.warehouses.list(),
  });

  const columns: ColumnsType<InventoryTransaction> = [
    {
      title: 'Date',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    { title: 'SKU', dataIndex: 'sku', width: 140 },
    { title: 'Product', dataIndex: 'productName' },
    { title: 'Warehouse', dataIndex: 'warehouseCode', width: 120 },
    {
      title: 'Type',
      dataIndex: 'movementType',
      width: 140,
      render: (value: MovementType) => (
        <Tag color={value === 'GOODS_RECEIPT' ? 'green' : value === 'SALES_ISSUE' ? 'red' : 'blue'}>
          {MOVEMENT_TYPE_LABELS[value]}
        </Tag>
      ),
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (value: number) => (
        <Typography.Text type={value < 0 ? 'danger' : undefined} strong>
          {value > 0 ? `+${formatQuantity(value)}` : formatQuantity(value)}
        </Typography.Text>
      ),
    },
    {
      title: 'Unit cost',
      dataIndex: 'unitCost',
      width: 110,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'By',
      dataIndex: 'createdByName',
      width: 140,
    },
  ];

  return (
    <>
      <PageHeader
        title="Inventory Movements"
        subtitle="Append-only ledger of every stock movement."
      />

      {isDataError(movementsQ.error) ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={movementsQ.error.message}
        />
      ) : null}

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="Movement type"
            style={{ width: 180 }}
            options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
            value={type}
            onChange={setType}
          />
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
            value={productId}
            onChange={setProductId}
          />
          <Select
            allowClear
            placeholder="Warehouse"
            style={{ width: 200 }}
            options={(warehousesQ.data ?? []).map((w) => ({
              value: w.warehouseId,
              label: `${w.code} — ${w.name}`,
            }))}
            value={warehouseId}
            onChange={setWarehouseId}
          />
          <DatePicker.RangePicker
            value={range}
            allowClear
            onChange={(value) => setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)}
          />
        </Space>
      </Card>

      <Table<InventoryTransaction>
        rowKey="transactionId"
        loading={movementsQ.isLoading}
        columns={columns}
        dataSource={movementsQ.data ?? []}
        locale={{ emptyText: 'No movements match the filters' }}
      />
    </>
  );
}
