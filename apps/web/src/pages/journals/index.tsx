import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { JOURNAL_STATUSES, type JournalEntry, type JournalEntryLine, type JournalStatus } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { JOURNAL_STATUS_COLORS, formatMoney } from '@/lib/format';

interface ListFilter {
  status?: JournalStatus;
  search?: string;
  from?: string;
  to?: string;
}

export default function JournalsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = usePermission();

  const [status, setStatus] = useState<JournalStatus | undefined>();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const filter = useMemo<ListFilter>(
    () => ({
      status,
      search: search || undefined,
      from: range?.[0].format('YYYY-MM-DD'),
      to: range?.[1].format('YYYY-MM-DD'),
    }),
    [status, search, range],
  );

  const journalsQ = useQuery({
    queryKey: ['journals', filter],
    queryFn: () => data.journals.list(filter),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['journals'] });
  };

  const post = useMutation({
    mutationFn: (entryId: string) => data.journals.post(entryId),
    onSuccess: () => {
      message.success('Entry posted');
      invalidate();
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not post the entry');
    },
  });

  const voidEntry = useMutation({
    mutationFn: (entryId: string) => data.journals.void(entryId),
    onSuccess: () => {
      message.success('Entry voided');
      invalidate();
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not void the entry');
    },
  });

  const lineColumns: ColumnsType<JournalEntryLine> = [
    { title: 'Account', dataIndex: 'accountCode', width: 100 },
    { title: 'Name', dataIndex: 'accountName' },
    {
      title: 'Type',
      dataIndex: 'entryType',
      width: 100,
      render: (type: JournalEntryLine['entryType']) => (
        <Tag color={type === 'DEBIT' ? 'blue' : 'orange'}>{type}</Tag>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      width: 130,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | null) => value ?? '—',
    },
  ];

  const columns: ColumnsType<JournalEntry> = [
    { title: 'Number', dataIndex: 'entryNumber', width: 110 },
    { title: 'Date', dataIndex: 'entryDate', width: 110 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (value: JournalEntry['status']) => (
        <Tag color={JOURNAL_STATUS_COLORS[value]}>{value}</Tag>
      ),
    },
    {
      title: 'Reference',
      dataIndex: 'referenceType',
      width: 180,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'Debit',
      dataIndex: 'totalDebit',
      width: 120,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Credit',
      dataIndex: 'totalCredit',
      width: 120,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Created by',
      dataIndex: 'createdByName',
      width: 140,
      render: (value: string) => value,
    },
  ];

  if (can('journals:write') || can('journals:post')) {
    columns.push({
      title: '',
      key: 'actions',
      width: 220,
      render: (_, entry) => (
        <Space>
          {entry.status === 'DRAFT' && can('journals:write') ? (
            <Button
              size="small"
              onClick={() => navigate(`/accounting/journals/${entry.entryId}/edit`)}
            >
              Edit
            </Button>
          ) : null}
          {entry.status === 'DRAFT' && can('journals:post') ? (
            <Popconfirm
              title="Post this entry?"
              description="Posted entries become part of the ledger and cannot be edited."
              onConfirm={() => post.mutate(entry.entryId)}
            >
              <Button size="small" type="primary" ghost>
                Post
              </Button>
            </Popconfirm>
          ) : null}
          {entry.status !== 'VOIDED' && can('journals:post') ? (
            <Popconfirm title="Void this entry?" onConfirm={() => voidEntry.mutate(entry.entryId)}>
              <Button size="small" danger>
                Void
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Journal Entries"
        subtitle="Double-entry ledger. Post requires balanced lines."
        extra={
          can('journals:write') ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/accounting/journals/new')}
            >
              New entry
            </Button>
          ) : undefined
        }
      />

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 140 }}
            options={JOURNAL_STATUSES.map((s) => ({ value: s, label: s }))}
            value={status}
            onChange={(value) => setStatus(value)}
          />
          <DatePicker.RangePicker
            value={range}
            onChange={(value) => setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)}
            allowClear
          />
          <Input.Search
            placeholder="Search number or reference"
            allowClear
            style={{ width: 240 }}
            onSearch={(value) => setSearch(value)}
          />
        </Space>
      </Card>

      <Table<JournalEntry>
        rowKey="entryId"
        loading={journalsQ.isLoading}
        columns={columns}
        dataSource={journalsQ.data ?? []}
        locale={{ emptyText: 'No journal entries match the filters' }}
        expandable={{
          expandedRowRender: (entry) => (
            <Table<JournalEntryLine>
              rowKey="lineId"
              size="small"
              columns={lineColumns}
              dataSource={entry.lines}
              pagination={false}
            />
          ),
        }}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Tip: click a row to expand its lines. See the{' '}
        <Link to="/accounting/trial-balance">trial balance</Link> for totals per account.
        Seed data covers {dayjs('2026-01-01').format('MMMM YYYY')} — use the date filter to find it.
      </Typography.Paragraph>
    </>
  );
}
