import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Statistic, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import type { InventoryValuationRow } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { downloadCsv } from '@/lib/csv';
import { formatMoney, formatQuantity } from '@/lib/format';

/** Stock on hand valued at each product's company-wide weighted-average cost. */
export default function InventoryValuationPage() {
  const reportQ = useQuery({
    queryKey: ['inventory-valuation'],
    queryFn: () => data.reports.inventoryValuation(),
  });

  const rows = reportQ.data?.rows ?? [];
  const totalValue = reportQ.data?.totalValue ?? 0;

  const columns: ColumnsType<InventoryValuationRow> = [
    { title: 'SKU', dataIndex: 'sku', width: 160 },
    { title: 'Product', dataIndex: 'productName' },
    {
      title: 'On hand',
      dataIndex: 'quantityOnHand',
      width: 120,
      align: 'right',
      render: (value: number) => formatQuantity(value),
    },
    {
      title: 'Average cost',
      dataIndex: 'averageCost',
      width: 150,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Value',
      dataIndex: 'value',
      width: 160,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
  ];

  const exportCsv = () => {
    downloadCsv('inventory-valuation.csv', [
      ['SKU', 'Product', 'On hand', 'Average cost', 'Value'],
      ...rows.map((r) => [r.sku, r.productName, r.quantityOnHand, r.averageCost, r.value]),
      ['Total', '', '', '', totalValue],
    ]);
  };

  return (
    <>
      <PageHeader
        title="Inventory Valuation"
        subtitle="Stock on hand at the company-wide weighted-average cost."
        extra={
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        }
      />

      {isDataError(reportQ.error) ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Could not load the inventory valuation"
          description={reportQ.error.message}
        />
      ) : null}

      <Card style={{ marginBottom: 16 }}>
        <Statistic title="Total inventory value" value={totalValue} precision={2} prefix="$" />
      </Card>

      <Table<InventoryValuationRow>
        rowKey="productId"
        loading={reportQ.isLoading}
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: 'No stock on hand' }}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={4}>
              <Typography.Text strong>Total</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">
              <Typography.Text strong>{formatMoney(totalValue)}</Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Receipts blend into the average cost; issues and adjustments are valued at that average.
        Value should track the inventory account once every movement is posted to the ledger.
      </Typography.Paragraph>
    </>
  );
}
