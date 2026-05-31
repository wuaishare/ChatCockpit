import { Button, List, Tag } from "antd";

import type { SetupStatusResponse } from "../types";
import { SectionCard } from "./SectionCard";
import type { LocaleCode } from "../i18n";
import { getUiCopy } from "../i18n";

interface SetupWizardViewProps {
  locale: LocaleCode;
  setupStatus: SetupStatusResponse | null;
  onOpenGptHelper: () => void;
  onRefresh: () => void;
}

export function SetupWizardView({
  locale,
  setupStatus,
  onOpenGptHelper,
  onRefresh
}: SetupWizardViewProps) {
  const copy = getUiCopy(locale);

  if (!setupStatus) {
    return null;
  }

  return (
    <SectionCard
      title={copy.setup.title}
      description={copy.setup.description}
      extra={
        <Tag color={setupStatus.ready ? "success" : "warning"}>
          {setupStatus.ready ? copy.setup.readyTag : copy.setup.pendingTag}
        </Tag>
      }
    >
      <div className="setup-wizard">
        <List
          dataSource={setupStatus.steps}
          renderItem={(step, index) => {
            const localizedStep = copy.setup.steps[step.key];
            return (
              <List.Item>
                <div className="setup-step">
                  <div className="setup-step__index">{index + 1}</div>
                  <div className="setup-step__body">
                    <div className="setup-step__title">
                      <strong>{localizedStep.label}</strong>
                      <Tag color={step.ok ? "success" : "warning"}>
                        {step.ok ? copy.setup.readyTag : copy.setup.pendingTag}
                      </Tag>
                    </div>
                    <p>{step.ok ? localizedStep.detailReady : localizedStep.detailPending}</p>
                    <span>{step.ok ? localizedStep.nextReady : localizedStep.nextPending}</span>
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
        <div className="setup-wizard__actions">
          <Button onClick={onRefresh}>{copy.setup.refresh}</Button>
          <Button type="primary" onClick={onOpenGptHelper}>
            {copy.setup.openGptHelper}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
