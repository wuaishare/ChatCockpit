import { CopyButton, Text } from "@lobehub/ui";
import { Button } from "antd";
import { useMemo } from "react";
import type { GptConfigModel, HealthModel } from "../types";
import { buildGptHelperText, formatDateTime } from "../utils";
import { SectionCard } from "./SectionCard";
import type { LocaleCode } from "../i18n";
import { getUiCopy } from "../i18n";

interface GptHelperViewProps {
  locale: LocaleCode;
  health: HealthModel;
  config: GptConfigModel | null;
  configError: string | null;
}

export function GptHelperView({ locale, health, config, configError }: GptHelperViewProps) {
  const copy = getUiCopy(locale);
  const fallbackText = useMemo(() => buildGptHelperText(health, locale), [health, locale]);
  const helperText = config?.instructions ?? fallbackText;
  const facts = [
    { label: copy.gpt.versionLabel, value: config?.version ?? copy.common.notAvailable },
    {
      label: copy.gpt.updatedAtLabel,
      value: config?.updatedAt ? formatDateTime(config.updatedAt) : copy.common.notAvailable
    },
    { label: copy.gpt.modeLabel, value: health.mode },
    { label: copy.gpt.authRequiredLabel, value: health.authRequired ? copy.status.yes : copy.status.no },
    { label: copy.gpt.openapiLabel, value: config?.openapiUrl ?? health.openapiUrl },
    { label: copy.gpt.publicBaseUrlLabel, value: config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable },
    { label: copy.gpt.actionHostLabel, value: config?.actionHost ?? copy.common.notAvailable },
    { label: copy.gpt.schemaImportUrlLabel, value: config?.schemaImportUrl ?? health.openapiUrl }
  ];

  const checklistItems = copy.gpt.checklist.slice(1);
  const notes = config?.notes ?? [copy.gpt.fallbackNote];
  const summaryText = [
    `${copy.gpt.versionLabel}: ${config?.version ?? copy.common.notAvailable}`,
    `${copy.gpt.updatedAtLabel}: ${config?.updatedAt ?? copy.common.notAvailable}`,
    `${copy.gpt.openapiLabel}: ${config?.openapiUrl ?? health.openapiUrl}`,
    `${copy.gpt.publicBaseUrlLabel}: ${config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable}`,
    `${copy.gpt.actionHostLabel}: ${config?.actionHost ?? copy.common.notAvailable}`,
    `${copy.gpt.schemaImportUrlLabel}: ${config?.schemaImportUrl ?? health.openapiUrl}`
  ].join("\n");

  return (
    <div className="view-stack">
      <div className="gpt-layout">
        <SectionCard title={copy.gpt.snapshotTitle} description={copy.gpt.snapshotDescription}>
          <div className="section-note section-note--warning">
            <strong>{copy.gpt.boundaryTitle}</strong>
            <span>{copy.gpt.boundaryDescription}</span>
          </div>

          <div className="gpt-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="gpt-fact">
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </div>
            ))}
          </div>

          <div className="gpt-inline-note">
            <Text>{copy.gpt.tokenNote}</Text>
          </div>

          {configError ? <div className="notes-block">{configError}</div> : null}

          <div className="checklist-block checklist-block--compact">
            <strong className="checklist-block__title">{copy.gpt.checklist[0]}</strong>
            {checklistItems.map((item) => (
              <div key={item} className="checklist-block__item">
                {item.replace(/^- /, "")}
              </div>
            ))}
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.updateTitle}</strong>
            {notes.map((note) => (
              <div key={note} className="notes-block">
                {note}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title={copy.gpt.copyTitle}
          description={copy.gpt.copyDescription}
          extra={<CopyButton content={helperText} />}
        >
          <div className="copy-snippet">
            <pre className="text-snippet">{helperText}</pre>
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.quickCopyTitle}</strong>
            <div className="quick-actions__actions">
              <CopyButton content={config?.openapiUrl ?? health.openapiUrl} />
              <CopyButton content={config?.schemaImportUrl ?? health.openapiUrl} />
              <CopyButton content={summaryText} />
            </div>
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.importHintTitle}</strong>
            <div className="notes-block">{copy.gpt.importHintBody}</div>
            <pre className="job-detail__preview">{config?.schemaImportUrl ?? health.openapiUrl}</pre>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
