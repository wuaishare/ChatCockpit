import { CopyButton, Text, Tooltip } from "@lobehub/ui";
import { useMemo } from "react";
import { ClipboardCopy } from "lucide-react";
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
  const productVersion = config?.productVersion ?? __TOKENPILOT_VERSION__.productVersion;
  const schemaVersion = config?.schemaVersion ?? __TOKENPILOT_VERSION__.schemaVersion;
  const buildVersion = config?.buildVersion ?? __TOKENPILOT_VERSION__.buildVersion;
  const displayVersion = config?.version ?? __TOKENPILOT_VERSION__.version;
  const displayVersionValue = (
    <>
      <span>{productVersion}</span>{" "}
      <Tooltip title={buildVersion}>
        <span className="version-revision" title={buildVersion}>
          ({schemaVersion})
        </span>
      </Tooltip>
    </>
  );
  const facts = [
    { label: copy.gpt.versionLabel, value: displayVersionValue },
    { label: copy.gpt.productVersionLabel, value: productVersion },
    { label: copy.gpt.schemaVersionLabel, value: schemaVersion },
    { label: copy.gpt.buildVersionLabel, value: buildVersion },
    {
      label: copy.gpt.updatedAtLabel,
      value: config?.updatedAt ? formatDateTime(config.updatedAt) : copy.common.notAvailable
    },
    { label: copy.gpt.modeLabel, value: health.mode },
    { label: copy.gpt.authRequiredLabel, value: health.authRequired ? copy.status.yes : copy.status.no },
    { label: copy.gpt.publicBaseUrlLabel, value: config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable },
    { label: copy.gpt.actionHostLabel, value: config?.actionHost ?? copy.common.notAvailable },
    ...(showSeparateSchemaUrl ? [{ label: copy.gpt.schemaImportUrlLabel, value: importUrl }] : []),
    ...(!showSeparateSchemaUrl ? [{ label: copy.gpt.openapiLabel, value: openapiUrl }] : [])
  ];

  const checklistItems = copy.gpt.checklist.slice(1);
  const notes = config?.notes ?? [copy.gpt.fallbackNote];
  const summaryText = [
    `${copy.gpt.versionLabel}: ${displayVersion}`,
    `${copy.gpt.productVersionLabel}: ${productVersion}`,
    `${copy.gpt.schemaVersionLabel}: ${schemaVersion}`,
    `${copy.gpt.buildVersionLabel}: ${buildVersion}`,
    `${copy.gpt.updatedAtLabel}: ${config?.updatedAt ?? copy.common.notAvailable}`,
    `${copy.gpt.publicBaseUrlLabel}: ${config?.publicBaseUrl ?? health.publicBaseUrl ?? copy.common.notAvailable}`,
    `${copy.gpt.actionHostLabel}: ${config?.actionHost ?? copy.common.notAvailable}`,
    `${copy.gpt.openapiLabel}: ${openapiUrl}`,
    ...(showSeparateSchemaUrl ? [`${copy.gpt.schemaImportUrlLabel}: ${importUrl}`] : []),
    config?.repoGovernance
      ? `repoId: ${config.repoGovernance.repos.map((repo) => `${repo.repoId}=${repo.status}`).join(", ")}`
      : ""
  ].join("\n");

  return (
    <div className="view-stack">
      <div className="gpt-layout">
        <SectionCard title={copy.gpt.snapshotTitle} description={copy.gpt.snapshotDescription}>
          <div className="gpt-overview-actions">
            <CopyButton
              aria-label={copy.gpt.copySummaryAction}
              content={summaryText}
              icon={ClipboardCopy}
            />
          </div>

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
          extra={
            <CopyButton
              aria-label={copy.gpt.copyInstructionsAction}
              content={helperText}
              icon={ClipboardCopy}
            />
          }
        >
          <div className="copy-snippet">
            <pre className="text-snippet">{helperText}</pre>
          </div>

          <div className="job-detail__block">
            <strong>{copy.gpt.importHintTitle}</strong>
            <div className="notes-block">{copy.gpt.importHintBody}</div>
            <div className="gpt-schema-line">
              <pre className="job-detail__preview">{importUrl}</pre>
              <CopyButton
                aria-label={copy.gpt.copySchemaAction}
                content={importUrl}
                icon={ClipboardCopy}
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
