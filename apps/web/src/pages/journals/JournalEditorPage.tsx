import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { ENTRY_TYPES, type EntryType } from '@erp/shared';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';
import { formatMoney } from '@/lib/format';
import { computeTotals } from '@/lib/journal';

interface LineValues {
  accountId?: string;
  entryType?: EntryType;
  amount?: number;
  description?: string;
}

interface EditorValues {
  entryDate?: Dayjs;
  referenceType?: string;
  lines: LineValues[];
}

export default function JournalEditorPage() {
  const { entryId } = useParams();
  const isEdit = Boolean(entryId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const can = usePermission();
  const [form] = Form.useForm<EditorValues>();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => data.accounts.list({ active: true }),
  });

  const entryQ = useQuery({
    queryKey: ['journal', entryId],
    queryFn: () => data.journals.get(entryId!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (entryQ.data) {
      form.setFieldsValue({
        entryDate: dayjs(entryQ.data.entryDate),
        referenceType: entryQ.data.referenceType ?? undefined,
        lines: entryQ.data.lines.map((line) => ({
          accountId: line.accountId,
          entryType: line.entryType,
          amount: line.amount,
          description: line.description ?? undefined,
        })),
      });
    }
  }, [entryQ.data, form]);

  const lines = Form.useWatch('lines', form) ?? [];
  const { totalDebit, totalCredit } = computeTotals(lines);
  const difference = Math.round((totalDebit - totalCredit) * 10000) / 10000;
  const balanced = difference === 0 && totalDebit > 0;

  const accountOptions = (accountsQ.data ?? []).map((a) => ({
    value: a.accountId,
    label: `${a.accountCode} — ${a.accountName}`,
  }));

  const save = useMutation({
    mutationFn: async (values: EditorValues) => {
      const payload = {
        entryDate: (values.entryDate ?? dayjs()).format('YYYY-MM-DD'),
        referenceType: values.referenceType?.trim() || null,
        lines: values.lines.map((line) => ({
          accountId: line.accountId as string,
          entryType: line.entryType as EntryType,
          amount: line.amount as number,
          description: line.description?.trim() || null,
        })),
      };
      return isEdit ? data.journals.update(entryId!, payload) : data.journals.create(payload);
    },
    onSuccess: () => {
      message.success(isEdit ? 'Entry updated' : 'Draft entry created');
      void queryClient.invalidateQueries({ queryKey: ['journals'] });
      void queryClient.invalidateQueries({ queryKey: ['journal'] });
      navigate('/accounting/journals');
    },
    onError: (error) => {
      message.error(isDataError(error) ? error.message : 'Could not save the entry');
    },
  });

  const notEditable = isEdit && entryQ.data && entryQ.data.status !== 'DRAFT';
  const writable = can('journals:write');

  return (
    <>
      <PageHeader
        title={isEdit ? `Edit entry ${entryQ.data?.entryNumber ?? ''}` : 'New journal entry'}
        subtitle="Drafts may be unbalanced; posting requires total debits equal to total credits."
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounting/journals')}>
            Back to list
          </Button>
        }
      />

      {notEditable ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`This entry is ${entryQ.data?.status} and can no longer be edited.`}
        />
      ) : null}
      {!writable ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="You have read-only access to journals."
        />
      ) : null}

      <Card>
        <Form<EditorValues>
          form={form}
          layout="vertical"
          initialValues={{
            entryDate: dayjs(),
            lines: [{ entryType: 'DEBIT' }, { entryType: 'CREDIT' }],
          }}
          onFinish={(values) => save.mutate(values)}
        >
          <Space wrap align="start">
            <Form.Item
              name="entryDate"
              label="Entry date"
              rules={[{ required: true, message: 'Pick a date' }]}
            >
              <DatePicker allowClear={false} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="referenceType" label="Reference type" style={{ minWidth: 220 }}>
              <Input placeholder="e.g. MANUAL" maxLength={50} />
            </Form.Item>
          </Space>

          <Typography.Title level={5} style={{ marginTop: 8 }}>
            Lines
          </Typography.Title>
          <Form.List name="lines">
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap style={{ display: 'flex' }}>
                    <Form.Item
                      name={[field.name, 'accountId']}
                      rules={[{ required: true, message: 'Select an account' }]}
                      style={{ margin: '0 0 8px', minWidth: 260 }}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Account"
                        options={accountOptions}
                        loading={accountsQ.isLoading}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'entryType']}
                      rules={[{ required: true, message: 'Debit or credit' }]}
                      style={{ margin: '0 0 8px', width: 120 }}
                    >
                      <Select options={ENTRY_TYPES.map((t) => ({ value: t, label: t }))} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'amount']}
                      rules={[{ required: true, message: 'Enter an amount' }]}
                      style={{ margin: '0 0 8px', width: 150 }}
                    >
                      <InputNumber
                        min={0.0001}
                        step={0.01}
                        placeholder="Amount"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'description']}
                      style={{ margin: '0 0 8px', width: 220 }}
                    >
                      <Input placeholder="Description (optional)" maxLength={500} />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={fields.length <= 2}
                      onClick={() => remove(field.name)}
                      style={{ marginBottom: 8 }}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ entryType: 'DEBIT' })}
                  style={{ width: 160 }}
                  disabled={!writable}
                >
                  Add line
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>

          <Space style={{ marginTop: 24 }} align="center" wrap>
            <Tag data-testid="balance-indicator" color={balanced ? 'green' : 'orange'}>
              {totalDebit === 0 && totalCredit === 0
                ? 'No amounts yet'
                : balanced
                  ? `Balanced — ${formatMoney(totalDebit)}`
                  : `Out of balance by ${formatMoney(Math.abs(difference))}`}
            </Tag>
            <Typography.Text type="secondary">
              Debits {formatMoney(totalDebit)} · Credits {formatMoney(totalCredit)}
            </Typography.Text>
          </Space>

          <div style={{ marginTop: 24 }}>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={save.isPending}
                disabled={!writable || Boolean(notEditable)}
              >
                Save draft
              </Button>
              <Button onClick={() => navigate('/accounting/journals')}>Cancel</Button>
            </Space>
          </div>
        </Form>
      </Card>
    </>
  );
}
