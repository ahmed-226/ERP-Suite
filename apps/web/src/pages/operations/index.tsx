import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Tabs, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/auth/usePermission';
import { PageHeader } from '@/components/PageHeader';
import { data } from '@/data/client';
import { isDataError } from '@/data/errors';

interface ReceiptValues {
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
}

interface IssueValues {
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost?: number;
}

interface TransferValues {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
}

interface AdjustmentValues {
  productId: string;
  warehouseId: string;
  quantityDelta: number;
  unitCost?: number;
  reason: string;
}

/** Shared product/warehouse selects for the operation forms. */
function useMasterOptions() {
  const productsQ = useQuery({ queryKey: ['products'], queryFn: () => data.products.list() });
  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => data.warehouses.list(),
  });
  return {
    productOptions: (productsQ.data ?? []).map((p) => ({
      value: p.productId,
      label: `${p.sku} — ${p.name}`,
    })),
    warehouseOptions: (warehousesQ.data ?? []).map((w) => ({
      value: w.warehouseId,
      label: `${w.code} — ${w.name}`,
    })),
  };
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

function errorMessage(error: unknown): string {
  return isDataError(error) ? error.message : 'The operation failed';
}

function ReceiptForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ReceiptValues>();
  const { productOptions, warehouseOptions } = useMasterOptions();
  const invalidate = useInvalidateInventory();

  const receipt = useMutation({
    mutationFn: (values: ReceiptValues) =>
      data.inventory.receipt({
        productId: values.productId,
        warehouseId: values.warehouseId,
        quantity: values.quantity,
        unitCost: values.unitCost,
      }),
    onSuccess: () => {
      message.success('Goods received and posted to the ledger');
      form.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  return (
    <Form<ReceiptValues> form={form} layout="vertical" style={{ maxWidth: 460 }}>
      <Form.Item name="productId" label="Product" rules={[{ required: true, message: 'Select a product' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Product" options={productOptions} />
      </Form.Item>
      <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true, message: 'Select a warehouse' }]}>
        <Select placeholder="Warehouse" options={warehouseOptions} />
      </Form.Item>
      <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: 'Enter a quantity' }]}>
        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="unitCost" label="Unit cost" rules={[{ required: true, message: 'Enter a unit cost' }]}>
        <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
      </Form.Item>
      <Button type="primary" loading={receipt.isPending} onClick={() => form.submit()}>
        Receive goods
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Posts a balanced journal entry (debit Inventory, credit Accounts Payable).
      </Typography.Paragraph>
      {receipt.isError ? <Alert type="error" showIcon message={errorMessage(receipt.error)} /> : null}
    </Form>
  );
}

function IssueForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<IssueValues>();
  const { productOptions, warehouseOptions } = useMasterOptions();
  const invalidate = useInvalidateInventory();

  const issue = useMutation({
    mutationFn: (values: IssueValues) =>
      data.inventory.issue({
        productId: values.productId,
        warehouseId: values.warehouseId,
        quantity: values.quantity,
        unitCost: values.unitCost,
      }),
    onSuccess: () => {
      message.success('Goods issued and posted to the ledger');
      form.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  return (
    <Form<IssueValues> form={form} layout="vertical" style={{ maxWidth: 460 }}>
      <Form.Item name="productId" label="Product" rules={[{ required: true, message: 'Select a product' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Product" options={productOptions} />
      </Form.Item>
      <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true, message: 'Select a warehouse' }]}>
        <Select placeholder="Warehouse" options={warehouseOptions} />
      </Form.Item>
      <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: 'Enter a quantity' }]}>
        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="unitCost" label="Unit cost (optional)">
        <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
      </Form.Item>
      <Button type="primary" loading={issue.isPending} onClick={() => form.submit()}>
        Issue goods
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Refuses to go negative; posts debit COGS, credit Inventory.
      </Typography.Paragraph>
      {issue.isError ? <Alert type="error" showIcon message={errorMessage(issue.error)} /> : null}
    </Form>
  );
}

function TransferForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<TransferValues>();
  const { productOptions, warehouseOptions } = useMasterOptions();
  const invalidate = useInvalidateInventory();

  const transfer = useMutation({
    mutationFn: (values: TransferValues) =>
      data.inventory.transfer({
        productId: values.productId,
        fromWarehouseId: values.fromWarehouseId,
        toWarehouseId: values.toWarehouseId,
        quantity: values.quantity,
      }),
    onSuccess: () => {
      message.success('Stock transferred');
      form.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  return (
    <Form<TransferValues> form={form} layout="vertical" style={{ maxWidth: 460 }}>
      <Form.Item name="productId" label="Product" rules={[{ required: true, message: 'Select a product' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Product" options={productOptions} />
      </Form.Item>
      <Form.Item name="fromWarehouseId" label="From warehouse" rules={[{ required: true, message: 'Select the source' }]}>
        <Select placeholder="Source" options={warehouseOptions} />
      </Form.Item>
      <Form.Item
        name="toWarehouseId"
        label="To warehouse"
        rules={[
          { required: true, message: 'Select the destination' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || value !== getFieldValue('fromWarehouseId')) return Promise.resolve();
              return Promise.reject(new Error('Destination must differ from the source'));
            },
          }),
        ]}
      >
        <Select placeholder="Destination" options={warehouseOptions} />
      </Form.Item>
      <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: 'Enter a quantity' }]}>
        <InputNumber min={1} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Button type="primary" loading={transfer.isPending} onClick={() => form.submit()}>
        Transfer
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Records a paired TRANSFER_OUT / TRANSFER_IN movement; no GL entry.
      </Typography.Paragraph>
      {transfer.isError ? <Alert type="error" showIcon message={errorMessage(transfer.error)} /> : null}
    </Form>
  );
}

function AdjustmentForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<AdjustmentValues>();
  const { productOptions, warehouseOptions } = useMasterOptions();
  const invalidate = useInvalidateInventory();

  const adjust = useMutation({
    mutationFn: (values: AdjustmentValues) =>
      data.inventory.adjust({
        productId: values.productId,
        warehouseId: values.warehouseId,
        quantityDelta: values.quantityDelta,
        unitCost: values.unitCost,
        reason: values.reason,
      }),
    onSuccess: () => {
      message.success('Stock adjusted');
      form.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  return (
    <Form<AdjustmentValues> form={form} layout="vertical" style={{ maxWidth: 460 }}>
      <Form.Item name="productId" label="Product" rules={[{ required: true, message: 'Select a product' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Product" options={productOptions} />
      </Form.Item>
      <Form.Item name="warehouseId" label="Warehouse" rules={[{ required: true, message: 'Select a warehouse' }]}>
        <Select placeholder="Warehouse" options={warehouseOptions} />
      </Form.Item>
      <Form.Item
        name="quantityDelta"
        label="Quantity delta (negative to reduce)"
        rules={[{ required: true, message: 'Enter a non-zero delta' }]}
      >
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="unitCost" label="Unit cost (optional)">
        <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'Give a reason' }]}>
        <Input.TextArea rows={2} maxLength={500} placeholder="e.g. Damaged in storage" />
      </Form.Item>
      <Button type="primary" loading={adjust.isPending} onClick={() => form.submit()}>
        Apply adjustment
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        Corrections only — the delta cannot drive stock negative.
      </Typography.Paragraph>
      {adjust.isError ? <Alert type="error" showIcon message={errorMessage(adjust.error)} /> : null}
    </Form>
  );
}

export default function InventoryOperationsPage() {
  const can = usePermission();

  if (!can('inventory:write')) {
    return (
      <>
        <PageHeader title="Inventory Operations" subtitle="Receipt, issue, transfer and adjustment." />
        <Alert
          type="info"
          showIcon
          message="Read-only access"
          description="Inventory operations require the inventory:write permission."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Inventory Operations"
        subtitle="Every operation updates stock, appends to the movement ledger, and (where applicable) posts a journal entry."
      />
      <Card>
        <Tabs
          items={[
            { key: 'receipt', label: 'Goods Receipt', children: <ReceiptForm /> },
            { key: 'issue', label: 'Sales Issue', children: <IssueForm /> },
            { key: 'transfer', label: 'Transfer', children: <TransferForm /> },
            { key: 'adjustment', label: 'Adjustment', children: <AdjustmentForm /> },
          ]}
        />
      </Card>
    </>
  );
}
