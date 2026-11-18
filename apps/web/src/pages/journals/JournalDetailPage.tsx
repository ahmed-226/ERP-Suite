import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { JournalEntryLine } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { JOURNAL_STATUS_COLORS, formatMoney } from '@/lib/format';

function sourceLink(referenceType: string | null | undefined, referenceId: string | null | undefined): React.ReactNode {
  if (!referenceType) return '—';
  const label = referenceId ? `${referenceType} (${referenceId.slice(0, 8)}…)` : referenceType;
  if (referenceType === 'REVERSAL' && referenceId) {
    return <Link to={`/accounting/journals/${referenceId}`}>Original journal {referenceId.slice(0, 8)}…</Link>;
  }
  if (referenceType === 'YEAR_END_CLOSE') {
    return <Link to="/accounting/fiscal-periods">{label}</Link>;
  }
  if (referenceType === 'INVENTORY_RECEIPT' || referenceType === 'SALES_ISSUE' || referenceType === 'ADJUSTMENT') {
    return <Link to="/inventory/movements">{label}</Link>;
  }
  if (referenceType === 'STOCKTAKE') {
    return <Link to="/inventory/stocktakes">{label}</Link>;
  }
  return label;
}

export default function JournalDetailPage() {
  const { entryId = '' } = useParams();
  const navigate = useNavigate();
  const can = usePermission();
  const q = useQuery({
    queryKey: ['journal', entryId],
    queryFn: () => data.journals.get(entryId),
    enabled: !!entryId,
  });

  const entry = q.data;
  const columns: ColumnsType<JournalEntryLine> = [
    { title: 'Account', key: 'account', render: (_, r) => `${r.accountCode} — ${r.accountName}` },
    { title: 'Type', dataIndex: 'entryType', width: 100 },
    { title: 'Debit', align: 'right', width: 130, render: (_, r) => (r.entryType === 'DEBIT' ? formatMoney(r.amount) : '') },
    { title: 'Credit', align: 'right', width: 130, render: (_, r) => (r.entryType === 'CREDIT' ? formatMoney(r.amount) : '') },
    { title: 'Description', dataIndex: 'description', render: (v: string | null) => v ?? '—' },
  ];

  return (
    <>
      <PageHeader
        title={entry ? `Journal ${entry.entryNumber}` : 'Journal entry'}
        subtitle="Journal lines and source document reference."
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>Back</Button>
            {entry?.status === 'DRAFT' && can('journals:write') && (
              <Button icon={<EditOutlined />} type="primary" onClick={() => navigate(`/accounting/journals/${entry.entryId}/edit`)}>
                Edit
              </Button>
            )}
          </Space>
        }
      />
      {q.isError && (
        <Typography.Text type="danger">
          {isDataError(q.error) ? q.error.message : 'Failed to load journal entry'}
        </Typography.Text>
      )}
      {entry && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card size="small">
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="Number">{entry.entryNumber}</Descriptions.Item>
              <Descriptions.Item label="Date">{entry.entryDate}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={JOURNAL_STATUS_COLORS[entry.status]}>{entry.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Reference type">{entry.referenceType ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Source document">{sourceLink(entry.referenceType, entry.referenceId)}</Descriptions.Item>
              <Descriptions.Item label="Created by">{entry.createdByName}</Descriptions.Item>
              {entry.reversedByEntryId && (
                <Descriptions.Item label="Reversed by" span={3}>
                  <Link to={`/accounting/journals/${entry.reversedByEntryId}`}>{entry.reversedByEntryId}</Link>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
          <Table<JournalEntryLine>
            rowKey="lineId"
            columns={columns}
            dataSource={entry.lines}
            pagination={false}
            size="small"
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1} />
                <Table.Summary.Cell index={2} align="right"><strong>{formatMoney(entry.totalDebit)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><strong>{formatMoney(entry.totalCredit)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4} />
              </Table.Summary.Row>
            )}
          />
        </Space>
      )}
    </>
  );
}
