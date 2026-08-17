import { ArrowLeftOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";

import { getUiCopy, type LocaleCode } from "../i18n";

interface OperatorSecondFactorViewProps {
  locale: LocaleCode;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (verification: string) => void | Promise<void>;
}

export function OperatorSecondFactorView({
  locale,
  loading,
  error,
  onBack,
  onSubmit
}: OperatorSecondFactorViewProps) {
  const copy = getUiCopy(locale).operatorAuth;

  return (
    <div className="operator-auth-shell">
      <Card className="operator-auth-card" bordered={false}>
        <div className="operator-auth-card__heading">
          <Typography.Title level={2}>{copy.secondFactorTitle}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {copy.secondFactorDescription}
          </Typography.Paragraph>
        </div>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Form
          layout="vertical"
          onFinish={(values: { verification: string }) => onSubmit(values.verification)}
          requiredMark={false}
        >
          <Form.Item
            label={copy.verificationCode}
            name="verification"
            rules={[{ required: true }]}
            extra={copy.recoveryCodeHint}
          >
            <Input
              prefix={<SafetyCertificateOutlined />}
              autoComplete="one-time-code"
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              placeholder={copy.verificationPlaceholder}
              autoFocus
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            size="large"
          >
            {loading ? copy.verifyingSecondFactor : copy.verifySecondFactor}
          </Button>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            disabled={loading}
            onClick={onBack}
            block
          >
            {copy.backToPassword}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
