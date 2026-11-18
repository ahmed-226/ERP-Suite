import { DownloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import type {
  InventoryAgingRow,
  InventoryMovementSummaryRow,
  InventoryValuationRow,
} from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { downloadCsv } from '@/lib/csv';
import { formatMoney, formatQuantity } from '@/lib/format';

const { RangePicker } = DatePicker;

function defaultRange(): [string, string] {
  const to = dayjs();
  return [to.subtract(90, 'day').format('YYYY-MM-DD'), to.format('YYYY-MM-DD')];
}

/** Inventory valuation (by product/warehouse), movement summary, and aging reports. */
export default function InventoryValuationPage() {
  const [range, setRange] = useState<[string, string]>(defaultRange);
  const [asOf, setAsOf] = useState(dayjs().format('YYYY-MM-DD'));

  const valuationQ = useQuery({
    queryKey: ['inventory-valuation'],
    queryFn: () => data.reports.inventoryValuation(),
  });
  const summaryQ = useQuery({
    queryKey: ['inventory-movement-summary', range[0], range[1]],
    queryFn: () =>
      data.reports.inventoryMovementSummary({ from: range[0], to: range[1] }),
  });
  const agingQ = useQuery({
    queryKey: ['inventory-aging', asOf],
    queryFn: () => data.reports.inventoryAging({ asOf }),
  });

  const valuationRows = valuationQ.data?.rows ?? [];
  const totalValue = valuationQ.data?.totalValue ?? 0;
  const glBalance = valuationQ.data?.inventoryAccountBalance ?? 0;
  const difference = valuationQ.data?.difference ?? 0;
  const reconciled = Math.abs(difference) < 0.0001;

  const valuationColumns: ColumnsType<InventoryValuationRow> = useMemo(
    () => [
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: 'Product', dataIndex: 'productName' },
      { title: 'Warehouse', dataIndex: 'warehouseCode', width: 120 },
      {
        title: 'On hand',
        dataIndex: 'quantityOnHand',
        width: 110,
        align: 'right',
        render: (value: number) => formatQuantity(value),
      },
      {
        title: 'Average cost',
        dataIndex: 'averageCost',
        width: 140,
        align: 'right',
        render: (value: number) => formatMoney(value),
      },
      {
        title: 'Value',
        dataIndex: 'value',
        width: 140,
        align: 'right',
        render: (value: number) => formatMoney(value),
      },
    ],
    [],
  );

  const summaryColumns: ColumnsType<InventoryMovementSummaryRow> = useMemo(
    () => [
      { title: 'Period', dataIndex: 'period', width: 120 },
      { title: 'Type', dataIndex: 'movementType', width: 170 },
      { title: 'Moves', dataIndex: 'movementCount', width: 90, align: 'right' },
      {
        title: 'Qty in',
        dataIndex: 'quantityIn',
        width: 110,
        align: 'right',
        render: (v: number) => formatQuantity(v),
      },
      {
        title: 'Qty out',
        dataIndex: 'quantityOut',
        width: 110,
        align: 'right',
        render: (v: number) => formatQuantity(v),
      },
      {
        title: 'Movement value',
        dataIndex: 'totalValue',
        width: 150,
        align: 'right',
        render: (v: number) => formatMoney(v),
      },
    ],
    [],
  );

  const agingColumns: ColumnsType<InventoryAgingRow> = useMemo(
    () => [
      { title: 'SKU', dataIndex: 'sku', width: 140 },
      { title: 'Product', dataIndex: 'productName' },
      { title: 'Warehouse', dataIndex: 'warehouseCode', width: 120 },
      {
        title: 'On hand',
        dataIndex: 'quantityOnHand',
        width: 100,
        align: 'right',
        render: (v: number) => formatQuantity(v),
      },
      {
        title: 'Value',
        dataIndex: 'value',
        width: 130,
        align: 'right',
        render: (v: number) => formatMoney(v),
      },
      {
        title: 'Last movement',
        dataIndex: 'lastMovementAt',
        width: 180,
        render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
      },
      {
        title: 'Age (days)',
        dataIndex: 'daysSinceLastMovement',
        width: 120,
        align: 'right',
        render: (v: number | null) =>
          v === null ? <Tag>Unknown</Tag> : v >= 60 ? <Tag color="orange">{v}</Tag> : v,
        sorter: (a, b) =>
          (a.daysSinceLastMovement ?? -1) - (b.daysSinceLastMovement ?? -1),
        defaultSortOrder: 'descend',
      },
    ],
    [],
  );

  const exportValuation = () => {
    downloadCsv('inventory-valuation.csv', [
      ['SKU', 'Product', 'Warehouse', 'On hand', 'Average cost', 'Value'],
      ...valuationRows.map((r) => [
        r.sku,
        r.productName,
        r.warehouseCode,
        r.quantityOnHand,
        r.averageCost,
        r.value,
      ]),
      ['Total', '', '', '', '', totalValue],
      ['GL 1200 balance', '', '', '', '', glBalance],
      ['Difference', '', '', '', '', difference],
    ]);
  };

  return (
    <>
      <PageHeader
        title="Inventory Reports"
        subtitle="Valuation by product/warehouse, movement summary by type/period, and slow-moving/aging stock."
      />

      <Tabs
        items={[
          {
            key: 'valuation',
            label: 'Valuation',
            children: (
              <>
                {isDataError(valuationQ.error) ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Could not load inventory valuation"
                    description={valuationQ.error.message}
                  />
                ) : null}
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col xs={24} sm={8}>
                    <Card>
                      <Statistic title="Total inventory value" value={totalValue} precision={2} prefix="$" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card>
                      <Statistic title="GL 1200 balance" value={glBalance} precision={2} prefix="$" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card>
                      <Statistic
                        title="Reconciliation"
                        value={difference}
                        precision={2}
                        prefix="$"
                        valueStyle={{ color: reconciled ? '#3f8600' : '#cf1322' }}
                        suffix={
                          <Tag color={reconciled ? 'green' : 'red'} style={{ marginLeft: 8 }}>
                            {reconciled ? 'Reconciled' : 'Difference'}
                          </Tag>
                        }
                      />
                    </Card>
                  </Col>
                </Row>
                <Space style={{ marginBottom: 12 }}>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={exportValuation}
                    disabled={valuationRows.length === 0}
                  >
                    Export CSV
                  </Button>
                </Space>
                <Table<InventoryValuationRow>
                  rowKey={(r) => `${r.productId}:${r.warehouseId}`}
                  loading={valuationQ.isLoading}
                  columns={valuationColumns}
                  dataSource={valuationRows}
                  locale={{ emptyText: 'No stock on hand' }}
                  pagination={false}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        <Typography.Text strong>Total</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Typography.Text strong>{formatMoney(totalValue)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
                <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                  Valuation total should equal the posted inventory account (1200) balance.
                </Typography.Paragraph>
              </>
            ),
          },
          {
            key: 'summary',
            label: 'Movement summary',
            children: (
              <>
                {isDataError(summaryQ.error) ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Could not load movement summary"
                    description={summaryQ.error.message}
                  />
                ) : null}
                <Space style={{ marginBottom: 12 }}>
                  <RangePicker
                    value={[dayjs(range[0]), dayjs(range[1])]}
                    allowClear={false}
                    onChange={(vals) => {
                      if (vals?.[0] && vals?.[1]) {
                        setRange([vals[0].format('YYYY-MM-DD'), vals[1].format('YYYY-MM-DD')]);
                      }
                    }}
                  />
                </Space>
                <Table<InventoryMovementSummaryRow>
                  rowKey={(r) => `${r.period}:${r.movementType}`}
                  loading={summaryQ.isLoading}
                  columns={summaryColumns}
                  dataSource={summaryQ.data?.rows ?? []}
                  locale={{ emptyText: 'No movements in period' }}
                  pagination={false}
                />
              </>
            ),
          },
          {
            key: 'aging',
            label: 'Slow-moving / aging',
            children: (
              <>
                {isDataError(agingQ.error) ? (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Could not load aging report"
                    description={agingQ.error.message}
                  />
                ) : null}
                <Space style={{ marginBottom: 12 }}>
                  <Typography.Text>As of</Typography.Text>
                  <DatePicker
                    value={dayjs(asOf)}
                    allowClear={false}
                    onChange={(v) => v && setAsOf(v.format('YYYY-MM-DD'))}
                  />
                </Space>
                <Table<InventoryAgingRow>
                  rowKey={(r) => `${r.productId}:${r.warehouseId}`}
                  loading={agingQ.isLoading}
                  columns={agingColumns}
                  dataSource={agingQ.data?.rows ?? []}
                  locale={{ emptyText: 'No on-hand stock' }}
                  pagination={false}
                />
              </>
            ),
          },
        ]}
      />
    </>
  );
}
