import { CopyButton, Text } from "@lobehub/ui";
import { useMemo } from "react";
import type { HealthModel } from "../types";
import { buildGptHelperText } from "../utils";
import { SectionCard } from "./SectionCard";
import type { LocaleCode } from "../i18n";
import { getUiCopy } from "../i18n";

interface GptHelperViewProps {
  locale: LocaleCode;
  health: HealthModel;
}

export function GptHelperView({ locale, health }: GptHelperViewProps) {
  const copy = getUiCopy(locale);
  const helperText = useMemo(() => buildGptHelperText(health, locale), [health, locale]);
  const checklistItems = copy.gpt.checklist.slice(1);
  const facts = [
    { label: copy.gpt.modeLabel, value: health.mode },
    { label: copy.gpt.authRequiredLabel, value: health.authRequired ? copy.status.yes : copy.status.no },
    { label: copy.gpt.openapiLabel, value: health.openapiUrl },
    { label: copy.gpt.publicBaseUrlLabel, value: health.publicBaseUrl ?? copy.common.notAvailable }
  ];

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

          <div className="checklist-block checklist-block--compact">
            <strong className="checklist-block__title">{copy.gpt.checklist[0]}</strong>
            {checklistItems.map((item) => (
              <div key={item} className="checklist-block__item">
                {item.replace(/^- /, "")}
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
        </SectionCard>
      </div>
    </div>
  );
}
