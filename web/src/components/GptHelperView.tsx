import { CopyButton, Text } from "@lobehub/ui";
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
  const importUrl = config?.schemaImportUrl ?? health.openapiUrl;
  const openapiUrl = config?.openapiUrl ?? health.openapiUrl;
  const showSeparateSchemaUrl = importUrl !== openapiUrl;
  const facts = [
    { label: copy.gpt.versionLabel, value: config?.version ?? copy.common.notAvailable },
    {
      label: copy.gpt.updatedAtLabel,
      value: config?.updatedAt ? formatDateTime(config.updatedAt) : copy.common.notAvailable
    },
    { label: copy.gpt.modeLabel, value: health.mode },
    { label: copy.gpt.authRequiredLabel, value: health.authRequired ? copy.status.yes : copy.status.no },
    { label: copy.gpt.openapiLabel, value: openapiUrl },
    { label: copy.gpt.publicBaseUrlLabel, value: config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable },
    { label: copy.gpt.actionHostLabel, value: config?.actionHost ?? copy.common.notAvailable },
    ...(showSeparateSchemaUrl ? [{ label: copy.gpt.schemaImportUrlLabel, value: importUrl }] : [])
  ];

  const checklistItems = copy.gpt.checklist.slice(1);
  const notes = config?.notes ?? [copy.gpt.fallbackNote];
  const summaryText = [
    `${copy.gpt.versionLabel}: ${config?.version ?? copy.common.notAvailable}`,
    `${copy.gpt.updatedAtLabel}: ${config?.updatedAt ?? copy.common.notAvailable}`,
    `${copy.gpt.openapiLabel}: ${openapiUrl}`,
    `${copy.gpt.publicBaseUrlLabel}: ${config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable}`,
    `${copy.gpt.actionHostLabel}: ${config?.actionHost ?? copy.common.notAvailable}`,
    ...(showSeparateSchemaUrl ? [`${copy.gpt.schemaImportUrlLabel}: ${importUrl}`] : [])
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
          extra={<CopyButton content={helperText}>{copy.gpt.copyInstructionsAction}</CopyButton>}
        >
          <div className="copy-snippet">
            <pre className="text-snippet">{helperText}</pre>
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.quickCopyTitle}</strong>
            <div className="quick-actions__actions">
              <CopyButton content={openapiUrl}>{copy.gpt.copyOpenapiAction}</CopyButton>
              {showSeparateSchemaUrl ? (
                <CopyButton content={importUrl}>{copy.gpt.copySchemaAction}</CopyButton>
              ) : null}
              <CopyButton content={summaryText}>{copy.gpt.copySummaryAction}</CopyButton>
            </div>
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.importHintTitle}</strong>
            <div className="notes-block">{copy.gpt.importHintBody}</div>
            <pre className="job-detail__preview">{importUrl}</pre>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
