import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import type { TrialBalanceRow } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { downloadCsv } from '@/lib/csv';
import { ACCOUNT_TYPE_COLORS, formatMoney } from '@/lib/format';

export default function TrialBalancePage() {
  // Seed activity lives in early 2026; default the range wide enough to show it.
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()]);

  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const reportQ = useQuery({
    queryKey: ['trial-balance', from, to],
    queryFn: () => data.reports.trialBalance({ from, to }),
  });

  const rows = reportQ.data ?? [];
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const rounded = (n: number) => Math.round(n * 10000) / 10000;

  const columns: ColumnsType<TrialBalanceRow> = [
    { title: 'Code', dataIndex: 'accountCode', width: 110 },
    { title: 'Account', dataIndex: 'accountName' },
    {
      title: 'Type',
      dataIndex: 'accountType',
      width: 120,
      render: (type: TrialBalanceRow['accountType']) => (
        <Tag color={ACCOUNT_TYPE_COLORS[type]}>{type}</Tag>
      ),
    },
    {
      title: 'Debit',
      dataIndex: 'debit',
      width: 140,
      align: 'right',
      render: (value: number) => (value === 0 ? '—' : formatMoney(value)),
    },
    {
      title: 'Credit',
      dataIndex: 'credit',
      width: 140,
      align: 'right',
      render: (value: number) => (value === 0 ? '—' : formatMoney(value)),
    },
    {
      title: 'Net',
      dataIndex: 'net',
      width: 140,
      align: 'right',
      render: (value: number) => (value === 0 ? '—' : formatMoney(value)),
    },
  ];

  const exportCsv = () => {
    downloadCsv(`trial-balance-${from}-to-${to}.csv`, [
      ['Code', 'Account', 'Type', 'Debit', 'Credit', 'Net'],
      ...rows.map((r) => [r.accountCode, r.accountName, r.accountType, r.debit, r.credit, r.net]),
      ['Totals', '', '', rounded(totalDebit), rounded(totalCredit), rounded(totalDebit - totalCredit)],
    ]);
  };

  return (
    <>
      <PageHeader
        title="Trial Balance"
        subtitle="Posted entries grouped by account for a date range."
        extra={
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        }
      />

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Space>
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(value) => {
              if (value && value[0] && value[1]) setRange([value[0], value[1]]);
            }}
          />
        </Space>
      </Card>

      {isDataError(reportQ.error) ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Could not load the trial balance"
          description={reportQ.error.message}
        />
      ) : null}

      <Table<TrialBalanceRow>
        rowKey="accountId"
        loading={reportQ.isLoading}
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: 'No posted entries in this date range' }}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <Typography.Text strong>Totals</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <Typography.Text strong>{formatMoney(rounded(totalDebit))}</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">
              <Typography.Text strong>{formatMoney(rounded(totalCredit))}</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="right">
              <Typography.Text
                strong
                type={rounded(totalDebit - totalCredit) === 0 ? undefined : 'danger'}
              >
                {formatMoney(rounded(totalDebit - totalCredit))}
              </Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        The net column sums to zero across all accounts — that is the double-entry guarantee.
      </Typography.Paragraph>
    </>
  );
}
