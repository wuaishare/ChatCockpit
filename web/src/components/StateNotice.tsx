import { Alert, Button, Spin } from "antd";

interface StateNoticeProps {
  kind: "loading" | "empty" | "error";
  title: string;
  description?: string;
  retryLabel: string;
  onRetry?: () => void;
}

export function StateNotice({
  kind,
  title,
  description,
  retryLabel,
  onRetry
}: StateNoticeProps) {
  if (kind === "loading") {
    return (
      <div className="state-notice state-notice--loading">
        <Spin size="large" />
        <div>
          <strong>{title}</strong>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
    );
  }

  if (kind === "empty") {
    return (
      <div className="state-notice state-notice--card">
        <div className="state-card state-card--empty">
          <strong>{title}</strong>
          <p>{description || title}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="state-notice state-notice--card">
      <div className="state-card state-card--error">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
        {onRetry ? (
          <div className="state-card__actions">
            <Button type="primary" onClick={onRetry}>
              {retryLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InlineAlert(props: {
  title: string;
  description?: string;
  type?: "info" | "warning" | "error" | "success";
}) {
  return <Alert showIcon message={props.title} description={props.description} type={props.type} />;
}
