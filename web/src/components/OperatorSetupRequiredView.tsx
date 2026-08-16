import { Button, Card, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";

import { getUiCopy, type LocaleCode } from "../i18n";

interface OperatorSetupRequiredViewProps {
  locale: LocaleCode;
  checking: boolean;
  onRefresh: () => void | Promise<void>;
}

export function OperatorSetupRequiredView({
  locale,
  checking,
  onRefresh
}: OperatorSetupRequiredViewProps) {
  const copy = getUiCopy(locale).operatorAuth;

  return (
    <div className="operator-auth-shell">
      <Card className="operator-auth-card" bordered={false}>
        <div className="operator-auth-card__icon" aria-hidden="true">
          <SafetyCertificateOutlined />
        </div>
        <Typography.Title level={2}>{copy.setupTitle}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {copy.setupDescription}
        </Typography.Paragraph>
        <Typography.Text type="secondary">{copy.setupCommandLabel}</Typography.Text>
        <pre className="operator-auth-command"><code>{copy.setupCommand}</code></pre>
        <Button
          type="primary"
          block
          size="large"
          loading={checking}
          onClick={() => void onRefresh()}
        >
          {copy.setupRefresh}
        </Button>
      </Card>
    </div>
  );
}
