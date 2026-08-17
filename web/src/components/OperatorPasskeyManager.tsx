import { useEffect, useMemo, useState } from "react";

import {
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { startRegistration } from "@simplewebauthn/browser";

import {
  deleteOperatorPasskey,
  fetchOperatorPasskeys,
  fetchPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  type OperatorPasskeySummary
} from "../api";
import { getUiCopy, type LocaleCode } from "../i18n";
import {
  passkeyBrowserSupported,
  passkeyOriginSupported
} from "../passkey-support";
import { OperatorTotpManager } from "./OperatorTotpManager";

interface OperatorPasskeyManagerProps {
  locale: LocaleCode;
  open: boolean;
  onClose: () => void;
}

function formatDate(locale: LocaleCode, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function OperatorPasskeyManager({
  locale,
  open,
  onClose
}: OperatorPasskeyManagerProps) {
  const copy = getUiCopy(locale).operatorAuth;
  const [passkeys, setPasskeys] = useState<OperatorPasskeySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(copy.passkeyDefaultLabel);
  const originSupported = useMemo(() => passkeyOriginSupported(), []);
  const supported = useMemo(
    () => originSupported && passkeyBrowserSupported(),
    [originSupported]
  );

  useEffect(() => {
    setLabel(copy.passkeyDefaultLabel);
  }, [copy.passkeyDefaultLabel]);

  useEffect(() => {
    if (!open) return;
    if (!originSupported) {
      setPasskeys([]);
      setError(null);
      return;
    }
    void loadPasskeys();
  }, [open, originSupported]);

  async function loadPasskeys() {
    setLoading(true);
    setError(null);
    try {
      setPasskeys(await fetchOperatorPasskeys());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function addPasskey() {
    if (!supported) {
      setError(copy.passkeyUnavailable);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const options = await fetchPasskeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: options });
      const added = await verifyPasskeyRegistration({
        challenge: options.challenge,
        response,
        label: label.trim() || copy.passkeyDefaultLabel
      });
      setPasskeys((current) => [...current.filter((item) => item.id !== added.id), added]);
      message.success(copy.passkeyAdded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(false);
    }
  }

  function confirmRemove(passkey: OperatorPasskeySummary) {
    Modal.confirm({
      title: `${copy.removePasskey}: ${passkey.label}`,
      icon: <DeleteOutlined />,
      okText: copy.removePasskey,
      okButtonProps: { danger: true },
      cancelText: locale === "zh-CN" ? "取消" : "Cancel",
      async onOk() {
        await deleteOperatorPasskey(passkey.id);
        setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
        message.success(copy.passkeyRemoved);
      }
    });
  }

  return (
    <Modal
      title={
        <Space>
          <SafetyCertificateOutlined />
          {copy.security}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      destroyOnHidden
    >
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        <KeyOutlined /> {copy.passkeysTitle}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {copy.passkeysDescription}
      </Typography.Paragraph>

      {!supported ? (
        <Alert
          type="warning"
          showIcon
          message={originSupported ? copy.passkeyUnavailable : copy.passkeyOriginUnsupported}
        />
      ) : null}
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

      <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={copy.passkeyLabel}
          maxLength={64}
          disabled={!supported || adding}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={adding}
          disabled={!supported || loading}
          onClick={() => void addPasskey()}
        >
          {adding ? copy.addingPasskey : copy.addPasskey}
        </Button>
      </Space.Compact>

      <List
        loading={loading}
        dataSource={passkeys}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.passkeysEmpty} /> }}
        renderItem={(passkey) => (
          <List.Item
            actions={[
              <Button
                key="remove"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => confirmRemove(passkey)}
              >
                {copy.removePasskey}
              </Button>
            ]}
          >
            <List.Item.Meta
              avatar={<KeyOutlined style={{ fontSize: 20 }} />}
              title={
                <Space wrap>
                  <Typography.Text strong>{passkey.label}</Typography.Text>
                  <Tag>{passkey.backedUp ? copy.passkeyBackedUp : copy.passkeyDeviceOnly}</Tag>
                </Space>
              }
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text type="secondary" code>
                    {passkey.rpId}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {copy.passkeyLastUsed}: {passkey.lastUsedAt ? formatDate(locale, passkey.lastUsedAt) : copy.passkeyNeverUsed}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Divider />
      <OperatorTotpManager locale={locale} open={open} />
    </Modal>
  );
}
