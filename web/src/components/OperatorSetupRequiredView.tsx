import { Alert, Button, Card, Space, Typography } from "antd";
import { DesktopOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import { getUiCopy, type LocaleCode } from "../i18n";
import {
  DESKTOP_HOST_ACTIONS,
  desktopHostActionAttributes
} from "../desktop-host-bridge";

interface OperatorSetupRequiredViewProps {
  locale: LocaleCode;
  checking: boolean;
  desktopSetupAvailable: boolean;
  desktopHostCapabilityAvailable: boolean;
  feedback: string | null;
  feedbackError: boolean;
  onRefresh: () => void | Promise<void>;
}

export function OperatorSetupRequiredView({
  locale,
  checking,
  desktopSetupAvailable,
  desktopHostCapabilityAvailable,
  feedback,
  feedbackError,
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
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {desktopHostCapabilityAvailable || desktopSetupAvailable ? (
            <Button
              type="primary"
              block
              size="large"
              icon={<DesktopOutlined />}
              href={desktopHostCapabilityAvailable ? undefined : "chatcockpit://operator/setup"}
              {...desktopHostActionAttributes(DESKTOP_HOST_ACTIONS.operatorSetup)}
            >
              {copy.setupAppAction}
            </Button>
          ) : null}
          <Typography.Text type="secondary">{copy.setupCommandLabel}</Typography.Text>
          <pre className="operator-auth-command"><code>{copy.setupCommand}</code></pre>
          <Button
            block
            size="large"
            loading={checking}
            disabled={checking}
            onClick={() => void onRefresh()}
          >
            {copy.setupRefresh}
          </Button>
          {feedback ? (
            <Alert
              showIcon
              type={feedbackError ? "error" : "info"}
              message={feedback}
            />
          ) : null}
        </Space>
      </Card>
    </div>
  );
}
