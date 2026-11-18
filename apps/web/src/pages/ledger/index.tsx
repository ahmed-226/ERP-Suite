import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Card, DatePicker, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import type { AccountLedgerLine } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatMoney } from '@/lib/format';

function sourceLink(referenceType: string | null, referenceId: string | null): React.ReactNode {
  if (!referenceType) return '—';
  const label = referenceId ? `${referenceType} (${referenceId.slice(0, 8)}…)` : referenceType;
  if (referenceType === 'REVERSAL' && referenceId) {
    return <Link to={`/accounting/journals/${referenceId}`}>{label}</Link>;
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

export default function AccountLedgerPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()]);
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const ledgerQ = useQuery({
    queryKey: ['account-ledger', accountId, from, to],
    queryFn: () => data.reports.accountLedger(accountId, { from, to }),
    enabled: !!accountId,
  });

  const ledger = ledgerQ.data;
  const columns: ColumnsType<AccountLedgerLine> = [
    { title: 'Date', dataIndex: 'entryDate', width: 120 },
    {
      title: 'Journal',
      dataIndex: 'entryNumber',
      width: 120,
      render: (v: string, r) => <Link to={`/accounting/journals/${r.entryId}`}>{v}</Link>,
    },
    { title: 'Description', dataIndex: 'description', render: (v: string | null) => v ?? '—' },
    {
      title: 'Source',
      key: 'source',
      width: 240,
      render: (_, r) => sourceLink(r.referenceType, r.referenceId),
    },
    {
      title: 'Debit',
      dataIndex: 'debit',
      align: 'right',
      width: 130,
      render: (v: number) => (v ? formatMoney(v) : ''),
    },
    {
      title: 'Credit',
      dataIndex: 'credit',
      align: 'right',
      width: 130,
      render: (v: number) => (v ? formatMoney(v) : ''),
    },
    {
      title: 'Running balance',
      dataIndex: 'runningBalance',
      align: 'right',
      width: 150,
      render: (v: number) => <Typography.Text strong>{formatMoney(v)}</Typography.Text>,
    },
  ];

  return (
    <>
      <PageHeader
        title={ledger ? `Ledger: ${ledger.accountCode} ${ledger.accountName}` : 'Account Ledger'}
        subtitle="Posted journal lines with opening and running balance."
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounting/trial-balance')}>
              Back to trial balance
            </Button>
            <DatePicker.RangePicker
              value={range}
              allowClear={false}
              onChange={(values) => {
                if (values && values[0] && values[1]) setRange([values[0], values[1]]);
              }}
            />
          </Space>
        }
      />
      {ledgerQ.isError && (
        <Typography.Text type="danger">
          {isDataError(ledgerQ.error) ? ledgerQ.error.message : 'Failed to load account ledger'}
        </Typography.Text>
      )}
      {ledger && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card size="small">
            <Descriptions size="small" column={4}>
              <Descriptions.Item label="Account">{ledger.accountCode} — {ledger.accountName}</Descriptions.Item>
              <Descriptions.Item label="Type">{ledger.accountType}</Descriptions.Item>
              <Descriptions.Item label="Opening balance">{formatMoney(ledger.openingBalance)}</Descriptions.Item>
              <Descriptions.Item label="Closing balance">{formatMoney(ledger.closingBalance)}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Table<AccountLedgerLine>
            rowKey="lineId"
            columns={columns}
            dataSource={ledger.lines}
            loading={ledgerQ.isLoading}
            pagination={{ pageSize: 50 }}
            size="small"
          />
        </Space>
      )}
    </>
  );
}
