import { Alert, Card, DatePicker, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import type { StatementLine } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatMoney } from '@/lib/format';

const columns: ColumnsType<StatementLine> = [
  { title: 'Code', dataIndex: 'accountCode', width: 120, render: (v: string) => v || '—' },
  { title: 'Account', dataIndex: 'accountName' },
  { title: 'Amount', dataIndex: 'amount', align: 'right', width: 160, render: (v: number) => formatMoney(v) },
];

function Section({ title, lines, total }: { title: string; lines: StatementLine[]; total: number }) {
  return (
    <Card title={title} size="small">
      <Table<StatementLine>
        rowKey={(r) => r.accountId}
        size="small"
        columns={columns}
        dataSource={lines}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}><strong>Total {title.toLowerCase()}</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right"><strong>{formatMoney(total)}</strong></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Card>
  );
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const asOfDate = asOf.format('YYYY-MM-DD');

  const q = useQuery({
    queryKey: ['balance-sheet', asOfDate],
    queryFn: () => data.reports.balanceSheet({ asOf: asOfDate }),
  });
  const report = q.data;

  return (
    <>
      <PageHeader
        title="Balance Sheet"
        subtitle="Assets, liabilities and equity from posted journals as of a date (including current earnings)."
        extra={<DatePicker value={asOf} allowClear={false} onChange={(v) => v && setAsOf(v)} />}
      />
      {q.isError && (
        <Typography.Text type="danger">
          {isDataError(q.error) ? q.error.message : 'Failed to load balance sheet'}
        </Typography.Text>
      )}
      {report && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {!report.balanced && (
            <Alert
              type="warning"
              showIcon
              message="Balance sheet is out of balance"
              description={`Difference: ${formatMoney(report.difference)}`}
            />
          )}
          <Card size="small">
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="As of">{report.asOf}</Descriptions.Item>
              <Descriptions.Item label="Total assets">{formatMoney(report.assets.total)}</Descriptions.Item>
              <Descriptions.Item label="Liabilities + equity">{formatMoney(report.totalLiabilitiesAndEquity)}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Section title="Assets" lines={report.assets.lines} total={report.assets.total} />
          <Section title="Liabilities" lines={report.liabilities.lines} total={report.liabilities.total} />
          <Section title="Equity" lines={report.equity.lines} total={report.equity.total} />
        </Space>
      )}
    </>
  );
}
