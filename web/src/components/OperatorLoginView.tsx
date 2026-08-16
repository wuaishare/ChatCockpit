import { Alert, Button, Card, Divider, Form, Input, Typography } from "antd";
import { KeyOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";

import { getUiCopy, type LocaleCode } from "../i18n";
import {
  passkeyBrowserSupported,
  passkeyOriginSupported
} from "../passkey-support";

interface OperatorLoginViewProps {
  locale: LocaleCode;
  loading: boolean;
  passkeyLoading: boolean;
  error: string | null;
  onPasskey: () => void | Promise<void>;
  onSubmit: (input: { username: string; password: string }) => void | Promise<void>;
}

export function OperatorLoginView({
  locale,
  loading,
  passkeyLoading,
  error,
  onPasskey,
  onSubmit
}: OperatorLoginViewProps) {
  const copy = getUiCopy(locale).operatorAuth;
  const passkeyOriginAllowed = passkeyOriginSupported();
  const passkeySupported = passkeyOriginAllowed && passkeyBrowserSupported();

  return (
    <div className="operator-auth-shell">
      <Card className="operator-auth-card" bordered={false}>
        <div className="operator-auth-card__heading">
          <Typography.Title level={2}>{copy.loginTitle}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {copy.loginDescription}
          </Typography.Paragraph>
        </div>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {passkeySupported ? (
          <Button
            type="primary"
            block
            size="large"
            icon={<KeyOutlined />}
            loading={passkeyLoading}
            disabled={loading}
            onClick={() => void onPasskey()}
          >
            {passkeyLoading ? copy.usingPasskey : copy.usePasskey}
          </Button>
        ) : (
          <Alert
            type="info"
            showIcon
            message={
              passkeyOriginAllowed
                ? copy.passkeyUnavailable
                : copy.passkeyOriginUnsupported
            }
          />
        )}
        <Divider plain>{copy.passwordFallback}</Divider>
        <Form
          layout="vertical"
          initialValues={{ username: "owner" }}
          onFinish={(values: { username: string; password: string }) => onSubmit(values)}
          requiredMark={false}
        >
          <Form.Item
            label={copy.username}
            name="username"
            rules={[{ required: true }]}
          >
            <Input
              prefix={<UserOutlined />}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Form.Item>
          <Form.Item
            label={copy.password}
            name="password"
            rules={[{ required: true }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            disabled={passkeyLoading}
            block
            size="large"
          >
            {loading ? copy.signingIn : copy.signIn}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
