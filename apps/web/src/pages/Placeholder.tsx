import { Card, Empty, Tag, Typography } from 'antd';
import { PageHeader } from '@/components/PageHeader';

interface PlaceholderPageProps {
  title: string;
  phase: string;
}

/**
 * Stand-in for a page that a later phase will build. Keeps the navigation and
 * information architecture clickable while the app is being developed.
 */
export default function PlaceholderPage({ title, phase }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle="This screen is planned but not built yet."
        extra={<Tag color="blue">Phase {phase}</Tag>}
      />
      <Card>
        <Empty
          description={
            <Typography.Text type="secondary">
              Coming in phase {phase} of the implementation plan.
            </Typography.Text>
          }
        />
      </Card>
    </>
  );
}
