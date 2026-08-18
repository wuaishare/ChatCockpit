import { Button, Divider, Popover, Segmented } from "antd";
import { LogoutOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import type { ThemeMode } from "antd-style";
import { useState } from "react";

import { getUiCopy, localeOptions, type LocaleCode } from "../i18n";
import { themeLabels } from "../theme";

interface AppUtilityPopoverProps {
  locale: LocaleCode;
  themeMode: ThemeMode;
  username: string;
  onLocaleChange: (locale: LocaleCode) => void;
  onThemeModeChange: (themeMode: ThemeMode) => void;
  onOpenSecurity: () => void;
  onSignOut: () => void;
}

export function AppUtilityPopover({
  locale,
  themeMode,
  username,
  onLocaleChange,
  onThemeModeChange,
  onOpenSecurity,
  onSignOut
}: AppUtilityPopoverProps) {
  const [open, setOpen] = useState(false);
  const copy = getUiCopy(locale);

  const closeAndRun = (action: () => void) => {
    setOpen(false);
    action();
  };

  const content = (
    <div className="app-utility-popover">
      <div className="app-utility-popover__identity">
        <span>{copy.operatorAuth.signedInAs}</span>
        <strong>{username}</strong>
      </div>

      <div className="app-utility-popover__section">
        <span className="app-utility-popover__label">{copy.header.languageLabel}</span>
        <Segmented<LocaleCode>
          block
          value={locale}
          onChange={onLocaleChange}
          options={localeOptions}
        />
      </div>

      <div className="app-utility-popover__section">
        <span className="app-utility-popover__label">{copy.header.themeModeLabel}</span>
        <Segmented<ThemeMode>
          block
          value={themeMode}
          onChange={onThemeModeChange}
          options={[
            { label: themeLabels[locale].auto, value: "auto" },
            { label: themeLabels[locale].dark, value: "dark" },
            { label: themeLabels[locale].light, value: "light" }
          ]}
        />
      </div>

      <Divider />

      <div className="app-utility-popover__actions">
        <Button
          block
          icon={<SafetyCertificateOutlined />}
          onClick={() => closeAndRun(onOpenSecurity)}
        >
          {copy.operatorAuth.security}
        </Button>
        <Button
          block
          icon={<LogoutOutlined />}
          onClick={() => closeAndRun(onSignOut)}
        >
          {copy.operatorAuth.signOut}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      trigger="click"
    >
      <Button
        className="app-utility-trigger"
        icon={<UserOutlined />}
        aria-label={`${copy.header.accountAndAppearance}: ${username}`}
      >
        {username}
      </Button>
    </Popover>
  );
}
