import { Card, Col, DatePicker, Row, Statistic, Table, Typography } from 'antd';
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
  { title: 'Code', dataIndex: 'accountCode', width: 120 },
  { title: 'Account', dataIndex: 'accountName' },
  { title: 'Amount', dataIndex: 'amount', align: 'right', width: 160, render: (v: number) => formatMoney(v) },
];

export default function ProfitAndLossPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()]);
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const q = useQuery({
    queryKey: ['profit-and-loss', from, to],
    queryFn: () => data.reports.profitAndLoss({ from, to }),
  });
  const report = q.data;

  return (
    <>
      <PageHeader
        title="Profit & Loss"
        subtitle="Revenue and expenses from posted journals for the selected period (excluding year-end closing entries)."
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
          {isDataError(q.error) ? q.error.message : 'Failed to load profit and loss'}
        </Typography.Text>
      )}
      {report && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic title="Total revenue" value={report.totalRevenue} precision={2} prefix="$" />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic title="Total expenses" value={report.totalExpenses} precision={2} prefix="$" />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="Net income"
                  value={report.netIncome}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: report.netIncome >= 0 ? '#3f8600' : '#cf1322' }}
                />
              </Card>
            </Col>
          </Row>
          <Card title="Revenue" style={{ marginBottom: 16 }}>
            <Table<StatementLine> rowKey="accountId" size="small" columns={columns} dataSource={report.revenue} pagination={false} />
          </Card>
          <Card title="Expenses">
            <Table<StatementLine> rowKey="accountId" size="small" columns={columns} dataSource={report.expenses} pagination={false} />
          </Card>
        </>
      )}
    </>
  );
}
