import { LockOutlined, PlusOutlined, ReloadOutlined, UnlockOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { FiscalEvent, FiscalPeriod, FiscalYear } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';

export default function FiscalPeriodsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const can = usePermission();
  const canManage = can('accounts:write');
  const [yearOpen, setYearOpen] = useState(false);
  const [periodYearId, setPeriodYearId] = useState<string | null>(null);
  const [yearForm] = Form.useForm();
  const [periodForm] = Form.useForm();

  const yearsQ = useQuery({ queryKey: ['fiscal-years'], queryFn: () => data.fiscal.listYears() });
  const eventsQ = useQuery({ queryKey: ['fiscal-events'], queryFn: () => data.fiscal.events() });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fiscal-years'] }),
      queryClient.invalidateQueries({ queryKey: ['fiscal-events'] }),
    ]);
  };

  const createYear = useMutation({
    mutationFn: data.fiscal.createYear,
    onSuccess: async () => {
      message.success('Fiscal year created');
      setYearOpen(false);
      yearForm.resetFields();
      await invalidate();
    },
    onError: (e) => message.error(isDataError(e) ? e.message : 'Failed to create fiscal year'),
  });

  const createPeriod = useMutation({
    mutationFn: ({ fiscalYearId, input }: { fiscalYearId: string; input: { name: string; periodNumber: number; startDate: string; endDate: string } }) =>
      data.fiscal.createPeriod(fiscalYearId, input),
    onSuccess: async () => {
      message.success('Period created');
      setPeriodYearId(null);
      periodForm.resetFields();
      await invalidate();
    },
    onError: (e) => message.error(isDataError(e) ? e.message : 'Failed to create period'),
  });

  const closePeriod = useMutation({
    mutationFn: (periodId: string) => data.fiscal.closePeriod(periodId),
    onSuccess: async () => {
      message.success('Period closed');
      await invalidate();
    },
    onError: (e) => message.error(isDataError(e) ? e.message : 'Failed to close period'),
  });

  const reopenPeriod = useMutation({
    mutationFn: ({ periodId, reason }: { periodId: string; reason?: string }) =>
      data.fiscal.reopenPeriod(periodId, reason ? { reason } : {}),
    onSuccess: async () => {
      message.success('Period reopened');
      await invalidate();
    },
    onError: (e) => message.error(isDataError(e) ? e.message : 'Failed to reopen period'),
  });

  const yearEndClose = useMutation({
    mutationFn: (fiscalYearId: string) => data.fiscal.yearEndClose(fiscalYearId),
    onSuccess: async () => {
      message.success('Year-end close completed');
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['journals'] });
      await queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
    },
    onError: (e) => message.error(isDataError(e) ? e.message : 'Failed to run year-end close'),
  });

  const promptReopen = (period: FiscalPeriod) => {
    let reason = '';
    modal.confirm({
      title: `Reopen ${period.name}?`,
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">Reopening is audited. Provide a reason.</Typography.Text>
          <Input placeholder="Reason (optional)" onChange={(e) => { reason = e.target.value; }} />
        </Space>
      ),
      okText: 'Reopen',
      onOk: () => reopenPeriod.mutate({ periodId: period.periodId, reason: reason || undefined }),
    });
  };

  const confirmYearEnd = (year: FiscalYear) => {
    modal.confirm({
      title: `Run year-end close for ${year.name}?`,
      content: 'This closes all periods, posts a closing entry transferring revenue/expense to retained earnings, and closes the fiscal year.',
      okText: 'Run close',
      okButtonProps: { danger: true },
      onOk: () => yearEndClose.mutate(year.fiscalYearId),
    });
  };

  const periodColumns = (year: FiscalYear): ColumnsType<FiscalPeriod> => [
    { title: '#', dataIndex: 'periodNumber', width: 60 },
    { title: 'Period', dataIndex: 'name' },
    { title: 'Start', dataIndex: 'startDate', width: 120 },
    { title: 'End', dataIndex: 'endDate', width: 120 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (s: string) => <Tag color={s === 'OPEN' ? 'green' : 'default'}>{s}</Tag>,
    },
    {
      title: 'Actions',
      width: 220,
      render: (_, p) => (
        <Space>
          {canManage && p.status === 'OPEN' && (
            <Button size="small" icon={<LockOutlined />} onClick={() => closePeriod.mutate(p.periodId)} loading={closePeriod.isPending}>
              Close
            </Button>
          )}
          {canManage && p.status === 'CLOSED' && year.status === 'OPEN' && (
            <Button size="small" icon={<UnlockOutlined />} onClick={() => promptReopen(p)} loading={reopenPeriod.isPending}>
              Reopen
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const eventColumns: ColumnsType<FiscalEvent> = [
    { title: 'Time', dataIndex: 'createdAt', width: 190, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: 'Action', dataIndex: 'action', width: 160 },
    { title: 'Reason', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
    { title: 'By', dataIndex: 'actorName', width: 160 },
  ];

  return (
    <>
      <PageHeader
        title="Fiscal Periods"
        subtitle="Manage fiscal years and periods, lock posting, and run year-end close."
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void invalidate()}>Refresh</Button>
            {canManage && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setYearOpen(true)}>
                New fiscal year
              </Button>
            )}
          </Space>
        }
      />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {(yearsQ.data ?? []).map((year) => (
          <Card
            key={year.fiscalYearId}
            title={
              <Space>
                <span>{year.name}</span>
                <Typography.Text type="secondary">({year.startDate} – {year.endDate})</Typography.Text>
                <Tag color={year.status === 'OPEN' ? 'blue' : 'default'}>{year.status}</Tag>
              </Space>
            }
            extra={
              <Space>
                {canManage && year.status === 'OPEN' && (
                  <Button onClick={() => { setPeriodYearId(year.fiscalYearId); periodForm.resetFields(); }}>
                    Add period
                  </Button>
                )}
                {canManage && year.status === 'OPEN' && (
                  <Button danger onClick={() => confirmYearEnd(year)} loading={yearEndClose.isPending}>
                    Year-end close
                  </Button>
                )}
              </Space>
            }
          >
            <Table<FiscalPeriod>
              rowKey="periodId"
              size="small"
              columns={periodColumns(year)}
              dataSource={year.periods}
              pagination={false}
              locale={{ emptyText: 'No periods yet' }}
            />
          </Card>
        ))}

        <Card title="Recent activity">
          <Table<FiscalEvent>
            rowKey="eventId"
            size="small"
            columns={eventColumns}
            dataSource={eventsQ.data ?? []}
            pagination={{ pageSize: 10 }}
            loading={eventsQ.isLoading}
          />
        </Card>
      </Space>

      <Modal
        title="New fiscal year"
        open={yearOpen}
        onCancel={() => setYearOpen(false)}
        onOk={() => yearForm.submit()}
        confirmLoading={createYear.isPending}
        destroyOnClose
      >
        <Form
          form={yearForm}
          layout="vertical"
          onFinish={(values) => {
            createYear.mutate({
              name: values.name,
              startDate: values.range[0].format('YYYY-MM-DD'),
              endDate: values.range[1].format('YYYY-MM-DD'),
            });
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="FY 2026" />
          </Form.Item>
          <Form.Item name="range" label="Date range" rules={[{ required: true }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="New period"
        open={!!periodYearId}
        onCancel={() => setPeriodYearId(null)}
        onOk={() => periodForm.submit()}
        confirmLoading={createPeriod.isPending}
        destroyOnClose
      >
        <Form
          form={periodForm}
          layout="vertical"
          onFinish={(values) => {
            if (!periodYearId) return;
            createPeriod.mutate({
              fiscalYearId: periodYearId,
              input: {
                name: values.name,
                periodNumber: values.periodNumber,
                startDate: values.range[0].format('YYYY-MM-DD'),
                endDate: values.range[1].format('YYYY-MM-DD'),
              },
            });
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Jan 2026" />
          </Form.Item>
          <Form.Item name="periodNumber" label="Period number" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="range" label="Date range" rules={[{ required: true }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
