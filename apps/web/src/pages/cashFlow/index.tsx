import { Card, DatePicker, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import type { CashFlowLine } from '@erp/shared';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatMoney } from '@/lib/format';

const columns: ColumnsType<CashFlowLine> = [
  { title: 'Source', dataIndex: 'label' },
  { title: 'Reference', dataIndex: 'referenceType', width: 180, render: (v: string | null | undefined) => v ?? '—' },
  { title: 'Amount', dataIndex: 'amount', align: 'right', width: 160, render: (v: number) => formatMoney(v) },
];

function Section({ title, lines, total }: { title: string; lines: CashFlowLine[]; total: number }) {
  return (
    <Card title={title} size="small">
      <Table<CashFlowLine>
        rowKey={(_, i) => `${title}-${i}`}
        size="small"
        columns={columns}
        dataSource={lines}
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}><strong>Net {title.toLowerCase()}</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right"><strong>{formatMoney(total)}</strong></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Card>
  );
}

export default function CashFlowPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()]);
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const q = useQuery({
    queryKey: ['cash-flow', from, to],
    queryFn: () => data.reports.cashFlow({ from, to }),
  });
  const report = q.data;

  return (
    <>
      <PageHeader
        title="Cash Flow Statement"
        subtitle="Cash and cash equivalents movement derived from posted journals for the selected period."
        extra={
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(values) => {
              if (values && values[0] && values[1]) setRange([values[0], values[1]]);
            }}
          />
        }
      />
      {q.isError && (
        <Typography.Text type="danger">
          {isDataError(q.error) ? q.error.message : 'Failed to load cash flow statement'}
        </Typography.Text>
      )}
      {report && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card size="small">
            <Descriptions size="small" column={4}>
              <Descriptions.Item label="Opening cash">{formatMoney(report.openingCash)}</Descriptions.Item>
              <Descriptions.Item label="Net change">{formatMoney(report.netChange)}</Descriptions.Item>
              <Descriptions.Item label="Closing cash">{formatMoney(report.closingCash)}</Descriptions.Item>
              <Descriptions.Item label="Period">{report.from} – {report.to}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Section title="Operating activities" lines={report.operating.lines} total={report.operating.total} />
          <Section title="Investing activities" lines={report.investing.lines} total={report.investing.total} />
          <Section title="Financing activities" lines={report.financing.lines} total={report.financing.total} />
        </Space>
      )}
    </>
  );
}
