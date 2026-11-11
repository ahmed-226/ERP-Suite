import { Alert, Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import type { InventoryStock, JournalEntry } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { JOURNAL_STATUS_COLORS, formatDate, formatQuantity } from '@/lib/format';

const lowStockColumns: ColumnsType<InventoryStock> = [
  { title: 'SKU', dataIndex: 'sku', width: 120 },
  { title: 'Product', dataIndex: 'productName' },
  { title: 'Warehouse', dataIndex: 'warehouseCode', width: 120 },
  {
    title: 'On hand',
    dataIndex: 'quantityOnHand',
    width: 100,
    align: 'right',
    render: (value: number, row) => (
      <Typography.Text type="danger">
        {formatQuantity(value)} / {formatQuantity(row.reorderThreshold)}
      </Typography.Text>
    ),
  },
];

const journalColumns: ColumnsType<JournalEntry> = [
  { title: 'Number', dataIndex: 'entryNumber', width: 120 },
  { title: 'Date', dataIndex: 'entryDate', width: 120, render: formatDate },
  {
    title: 'Status',
    dataIndex: 'status',
    width: 110,
    render: (status: JournalEntry['status']) => (
      <Tag color={JOURNAL_STATUS_COLORS[status]}>{status}</Tag>
    ),
  },
  { title: 'Reference', dataIndex: 'referenceType', render: (v: string | null) => v ?? '—' },
];

export default function DashboardPage() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => data.reports.dashboard(),
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live overview driven by the mock data source."
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Could not load dashboard"
          description={isDataError(error) ? error.message : String(error)}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Accounts" value={stats?.accountsCount ?? 0} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Products" value={stats?.productsCount ?? 0} loading={isLoading} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="Journals"
              value={stats?.journalsCount ?? 0}
              loading={isLoading}
              suffix={stats ? `(${stats.draftJournals} draft)` : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="Stock units"
              value={stats?.totalStockUnits ?? 0}
              loading={isLoading}
              valueStyle={stats && stats.lowStockCount > 0 ? { color: '#cf1322' } : undefined}
              suffix={stats ? `${stats.lowStockCount} low` : undefined}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Low stock" size="small">
            <Table
              rowKey="stockId"
              size="small"
              loading={isLoading}
              columns={lowStockColumns}
              dataSource={stats?.lowStock ?? []}
              pagination={false}
              locale={{ emptyText: 'No low-stock items' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Recent journal entries" size="small">
            <Table
              rowKey="entryId"
              size="small"
              loading={isLoading}
              columns={journalColumns}
              dataSource={stats?.recentJournals ?? []}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
