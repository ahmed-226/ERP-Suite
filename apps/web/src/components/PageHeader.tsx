import { Card, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

export function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
      <Space
        align="start"
        style={{ width: '100%', justifyContent: 'space-between' }}
        wrap
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          ) : null}
        </div>
        {extra ? <div>{extra}</div> : null}
      </Space>
    </Card>
  );
}
