import { Tag } from "antd";

import type { LocaleCode } from "../../i18n";
import {
  getProjectsCopy,
  projectActionTargetAvailabilityLabel,
  projectActionTargetReasonLabel
} from "../../i18n/projects";
import { isLocalProductActionPath } from "../../product-action-availability";
import type { ProductActionTargetAvailability } from "../../types";

interface ProjectActionTargetListProps {
  locale: LocaleCode;
  targets: readonly ProductActionTargetAvailability[];
  selectedTargetId?: string | null;
  onSelectLocalTarget?: (target: ProductActionTargetAvailability) => void;
}

function targetAvailabilityColor(
  target: ProductActionTargetAvailability
): "success" | "processing" | "warning" | "error" | "default" {
  if (target.availability === "available-local") return "success";
  if (target.availability === "available-targeted") return "processing";
  if (target.availability === "offline") return "error";
  if (
    target.availability === "requires-local-host" ||
    target.availability === "approval-required"
  ) {
    return "warning";
  }
  return "default";
}

export function ProjectActionTargetList({
  locale,
  targets,
  selectedTargetId = null,
  onSelectLocalTarget
}: ProjectActionTargetListProps) {
  const copy = getProjectsCopy(locale);

  if (targets.length === 0) {
    return (
      <div className="project-action-target-list is-empty">
        <span>{copy.actionAvailabilityUnknown}</span>
      </div>
    );
  }

  return (
    <div className="project-action-target-list" aria-label={copy.executionTargets}>
      {targets.map((target) => {
        const executableHere = isLocalProductActionPath(target);
        const selectable = executableHere && Boolean(onSelectLocalTarget);
        const selected = target.deviceId === selectedTargetId;
        const content = (
          <>
            <span className="project-action-target__identity">
              <strong>{target.displayName}</strong>
              <small>
                {target.locality === "local" ? copy.targetLocal : copy.targetRemote}
                {" · "}
                {target.platform}/{target.architecture}
              </small>
            </span>
            <Tag color={targetAvailabilityColor(target)}>
              {projectActionTargetAvailabilityLabel(locale, target)}
            </Tag>
            <span className="project-action-target__reason">
              {projectActionTargetReasonLabel(locale, target)}
            </span>
          </>
        );

        return selectable ? (
          <button
            type="button"
            key={target.deviceId}
            aria-pressed={selected}
            className={`project-action-target is-selectable${selected ? " is-selected" : ""}`}
            onClick={() => onSelectLocalTarget?.(target)}
          >
            {content}
          </button>
        ) : (
          <div
            key={target.deviceId}
            className={`project-action-target${selected ? " is-selected" : ""}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
