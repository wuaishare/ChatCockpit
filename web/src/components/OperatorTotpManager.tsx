import { useEffect, useState } from "react";

import {
  CheckCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message
} from "antd";

import {
  disableOperatorTotp,
  fetchOperatorTotpStatus,
  regenerateOperatorTotpRecoveryCodes,
  startOperatorTotpEnrollment,
  verifyOperatorTotpEnrollment,
  type OperatorTotpEnrollmentResponse,
  type OperatorTotpStatusResponse
} from "../api";
import { getUiCopy, type LocaleCode } from "../i18n";

interface OperatorTotpManagerProps {
  locale: LocaleCode;
  open: boolean;
}

type SecurityAction = "regenerate" | "disable" | null;

export function OperatorTotpManager({ locale, open }: OperatorTotpManagerProps) {
  const copy = getUiCopy(locale).operatorAuth;
  const [status, setStatus] = useState<OperatorTotpStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrollment, setEnrollment] = useState<OperatorTotpEnrollmentResponse | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<SecurityAction>(null);
  const [actionVerification, setActionVerification] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnrollment(null);
    setEnrollmentCode("");
    setRecoveryCodes(null);
    setAction(null);
    setActionVerification("");
    void loadStatus();
  }, [open]);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchOperatorTotpStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function startEnrollment() {
    setLoading(true);
    setError(null);
    setRecoveryCodes(null);
    try {
      const next = await startOperatorTotpEnrollment();
      setEnrollment(next);
      setEnrollmentCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnrollment() {
    if (!enrollment || !enrollmentCode.trim()) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await verifyOperatorTotpEnrollment({
        enrollmentId: enrollment.enrollmentId,
        code: enrollmentCode.trim()
      });
      setEnrollment(null);
      setEnrollmentCode("");
      setRecoveryCodes(result.recoveryCodes);
      setStatus({
        ok: true,
        enabled: true,
        recoveryCodesRemaining: result.recoveryCodesRemaining,
        pendingEnrollment: false
      });
      message.success(copy.totpEnabledSuccess);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConfirming(false);
    }
  }

  async function applySecurityAction() {
    if (!action || !actionVerification.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      if (action === "regenerate") {
        const result = await regenerateOperatorTotpRecoveryCodes(actionVerification.trim());
        setRecoveryCodes(result.recoveryCodes);
        setStatus((current) => ({
          ok: true,
          enabled: true,
          recoveryCodesRemaining: result.recoveryCodesRemaining,
          pendingEnrollment: current?.pendingEnrollment ?? false
        }));
        message.success(copy.recoveryCodesRegenerated);
      } else {
        await disableOperatorTotp(actionVerification.trim());
        setRecoveryCodes(null);
        setEnrollment(null);
        setStatus({
          ok: true,
          enabled: false,
          recoveryCodesRemaining: 0,
          pendingEnrollment: false
        });
        message.success(copy.totpDisabledSuccess);
      }
      setAction(null);
      setActionVerification("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionLoading(false);
    }
  }

  const enabled = status?.enabled === true;

  return (
    <div className="operator-totp-manager">
      <Space align="center" wrap style={{ marginBottom: 6 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          <SafetyCertificateOutlined /> {copy.totpTitle}
        </Typography.Title>
        <Tag color={enabled ? "success" : undefined} icon={enabled ? <CheckCircleOutlined /> : undefined}>
          {enabled ? copy.totpEnabled : copy.totpDisabled}
        </Tag>
      </Space>
      <Typography.Paragraph type="secondary">
        {copy.totpDescription}
      </Typography.Paragraph>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

      {recoveryCodes ? (
        <Alert
          type="success"
          showIcon
          message={copy.recoveryCodesTitle}
          description={
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Typography.Text>{copy.recoveryCodesDescription}</Typography.Text>
              <Typography.Paragraph
                code
                copyable={{ text: recoveryCodes.join("\n") }}
                style={{ whiteSpace: "pre-line", marginBottom: 0 }}
              >
                {recoveryCodes.join("\n")}
              </Typography.Paragraph>
            </Space>
          }
          style={{ marginBottom: 14 }}
        />
      ) : null}

      {enabled ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            {copy.totpRecoveryRemaining}: <strong>{status?.recoveryCodesRemaining ?? 0}</strong>
          </Typography.Text>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setAction("regenerate");
                setActionVerification("");
              }}
            >
              {copy.recoveryCodesRegenerate}
            </Button>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => {
                setAction("disable");
                setActionVerification("");
              }}
            >
              {copy.totpDisable}
            </Button>
          </Space>
        </Space>
      ) : enrollment ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert type="info" showIcon message={copy.totpSetupDescription} />
          <div>
            <Typography.Text type="secondary">{copy.totpSecretLabel}</Typography.Text>
            <Typography.Paragraph code copyable={{ text: enrollment.secret }} style={{ marginBottom: 8 }}>
              {enrollment.secret}
            </Typography.Paragraph>
          </div>
          <div>
            <Typography.Text type="secondary">{copy.totpUriLabel}</Typography.Text>
            <Typography.Paragraph
              code
              copyable={{ text: enrollment.otpauthUri }}
              ellipsis={{ rows: 2, expandable: true }}
              style={{ marginBottom: 8 }}
            >
              {enrollment.otpauthUri}
            </Typography.Paragraph>
          </div>
          <Input
            value={enrollmentCode}
            onChange={(event) => setEnrollmentCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={copy.totpCodeLabel}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
          />
          <Button
            type="primary"
            loading={confirming}
            disabled={enrollmentCode.length !== 6}
            onClick={() => void confirmEnrollment()}
          >
            {confirming ? copy.totpConfirming : copy.totpConfirm}
          </Button>
        </Space>
      ) : (
        <Button
          type="primary"
          icon={<SafetyCertificateOutlined />}
          loading={loading}
          onClick={() => void startEnrollment()}
        >
          {copy.totpSetup}
        </Button>
      )}

      <Modal
        open={action !== null}
        title={action === "disable" ? copy.totpDisable : copy.recoveryCodesRegenerate}
        okText={copy.confirmSecurityChange}
        okButtonProps={{ danger: action === "disable", loading: actionLoading }}
        cancelText={locale === "zh-CN" ? "取消" : "Cancel"}
        onCancel={() => {
          if (actionLoading) return;
          setAction(null);
          setActionVerification("");
        }}
        onOk={() => void applySecurityAction()}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {action === "disable" ? copy.totpDisableWarning : copy.recoveryCodesDescription}
        </Typography.Paragraph>
        <Input
          value={actionVerification}
          onChange={(event) => setActionVerification(event.target.value)}
          placeholder={copy.verificationForChange}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          onPressEnter={() => void applySecurityAction()}
        />
      </Modal>
    </div>
  );
}
