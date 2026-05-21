import { useState } from "react";
import { Text } from "@lobehub/ui";
import { Button, Input, Tag } from "antd";
import {
  DownOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  UpOutlined
} from "@ant-design/icons";
import { maskToken } from "../utils";
import type { LocaleCode } from "../i18n";
import { getUiCopy } from "../i18n";

interface TokenBarProps {
  locale: LocaleCode;
  authRequired: boolean;
  token: string | null;
  onSave: (value: string) => void;
  onClear: () => void;
}

export function TokenBar({ locale, authRequired, token, onSave, onClear }: TokenBarProps) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const copy = getUiCopy(locale);

  return (
    <div className={`token-bar${expanded ? " token-bar--expanded" : ""}`}>
      <div className="token-bar__summary">
        <div className="token-bar__meta">
          <div className="token-bar__icon" aria-hidden="true">
            {authRequired ? <LockOutlined /> : <KeyOutlined />}
          </div>
          <div className="token-bar__copy">
            <Text as="span" className="token-bar__title">
              {copy.tokenBar.title}
            </Text>
            <Text as="span" type="secondary" className="token-bar__hint">
              {authRequired
                ? copy.tokenBar.authRequiredShort
                : copy.tokenBar.optionalShort}
            </Text>
          </div>
        </div>
        <div className="token-bar__summary-actions">
          <Tag className="token-bar__tag" color={token ? "green" : "default"}>
            {maskToken(token, locale)}
          </Tag>
          <Button
            size="small"
            className="token-bar__toggle"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? copy.tokenBar.collapse : copy.tokenBar.expand}
          </Button>
        </div>
      </div>

      <div className="token-bar__controls">
        <Input.Password
          className="token-bar__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={copy.tokenBar.placeholder}
          autoComplete="off"
        />
        <div className="token-bar__actions">
          <Button
            className="token-bar__save-btn"
            type="primary"
            onClick={() => {
              onSave(draft);
              setDraft("");
              setExpanded(false);
            }}
            disabled={!draft.trim()}
          >
            {copy.common.save}
          </Button>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              onClear();
              setExpanded(false);
            }}
            disabled={!token}
          >
            {copy.common.clear}
          </Button>
        </div>
      </div>
    </div>
  );
}
