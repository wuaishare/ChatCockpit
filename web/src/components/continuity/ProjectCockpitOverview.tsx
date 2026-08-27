import { CodeOutlined, ControlOutlined, ProjectOutlined } from "@ant-design/icons";
import { Tag } from "antd";

import { getUiCopy, type LocaleCode } from "../../i18n";
import type {
  ContinuityProjectDetailResponse,
  ProjectCodexNextAction,
  ProjectCodexRuntimeAvailability,
  ProjectDevelopmentObservationStatus
} from "../../types";
import { UiText as Text } from "../UiText";

interface ProjectCockpitOverviewProps {
  locale: LocaleCode;
  detail: ContinuityProjectDetailResponse;
}

function observationColor(status: ProjectDevelopmentObservationStatus): string {
  if (status === "ready") return "success";
  if (status === "degraded") return "warning";
  return "default";
}

function runtimeColor(status: ProjectCodexRuntimeAvailability): string {
  if (status === "available") return "success";
  if (status === "unavailable") return "error";
  return "default";
}

function shortCommit(value: string | null): string {
  return value ? value.slice(0, 12) : "—";
}

export function ProjectCockpitOverview({ locale, detail }: ProjectCockpitOverviewProps) {
  const copy = getUiCopy(locale).continuity;
  const { project } = detail;
  const modelLoopOwnership = detail.developmentCoordination.modelLoopOwnership;
  const workspaceExecution = detail.developmentCoordination.workspaceExecution;
  const codexContinuity = detail.developmentCoordination.codexContinuity;
  const mcpApplicability = detail.developmentCoordination.mcpApplicability;
  const handoff = detail.developmentCoordination.handoff;
  const owner = modelLoopOwnerLabel(modelLoopOwnership, copy);
  const runtimeLabel = runtimeAvailabilityLabel(codexContinuity.runtimeAvailability, copy);
  const nextActionLabel = codexActionLabel(codexContinuity.nextAction, copy);

  return (
    <section className="project-cockpit" aria-labelledby="project-cockpit-title">
      <header className="project-cockpit__heading">
        <div>
          <Text as="h3" id="project-cockpit-title" className="project-cockpit__title">
            {copy.projectCockpitTitle}
          </Text>
          <Text as="p" type="secondary" className="project-cockpit__description">
            {copy.projectCockpitDescription}
          </Text>
        </div>
        <Tag color="processing">{project.status === "active" ? copy.statusActive : copy.statusArchived}</Tag>
      </header>

      <div className="project-cockpit-grid">
        <article className="project-cockpit-card">
          <CardHeading icon={<ProjectOutlined />} title={copy.projectWorkspaceCard} />
          <KeyValue label={copy.projectName} value={project.displayName} />
          <KeyValue label={copy.projectSlug} value={project.slug} code />
          <KeyValue label={copy.repoIdLabel} value={detail.developmentCoordination.repoId ?? "—"} code />
          <KeyValue label={copy.workspaceMode} value={workspaceModeLabel(workspaceExecution.mode, copy)} />
          <KeyValue label={copy.workspaceState} value={workspaceStateLabel(workspaceExecution.status, copy)} />
          <KeyValue label={copy.branch} value={workspaceExecution.branch ?? "—"} code />
          <KeyValue label={copy.headCommit} value={shortCommit(workspaceExecution.headCommit)} code />
          <div className="project-cockpit-card__tags">
            <Tag color={workspaceExecution.gitAvailable ? "success" : "default"}>
              {workspaceExecution.gitAvailable ? copy.gitLive : copy.gitUnavailable}
            </Tag>
            <Tag color={workspaceExecution.dirty ? "warning" : "success"}>
              {workspaceExecution.dirty ? copy.dirty : copy.clean}
            </Tag>
            {workspaceExecution.detached ? <Tag color="warning">{copy.detachedHead}</Tag> : null}
          </div>
        </article>

        <article className="project-cockpit-card">
          <CardHeading icon={<ControlOutlined />} title={copy.developmentControlCard} />
          <KeyValue label={copy.modelLoopOwner} value={owner} />
          <KeyValue
            label={copy.implicitCodexTurns}
            value={
              modelLoopOwnership.implicitCodexTurnAllowed
                ? "—"
                : copy.implicitCodexTurnsDisabled
            }
          />
          <div className="project-cockpit-card__section">
            <strong>{copy.codexContinuity}</strong>
            <div className="project-cockpit-card__tags">
              <Tag color={runtimeColor(codexContinuity.runtimeAvailability)}>
                {copy.codexRuntime}: {runtimeLabel}
              </Tag>
              <Tag color={observationColor(codexContinuity.observation.status)}>
                {copy.codexObservation}: {observationLabel(codexContinuity.observation.status, copy)}
              </Tag>
            </div>
            <KeyValue label={copy.codexNextAction} value={nextActionLabel} />
            <KeyValue
              label={copy.codexThread}
              value={threadLabel(codexContinuity.matchingThread, copy.noMatchingThread)}
            />
          </div>
          <div className="project-cockpit-card__section">
            <strong>{copy.handoffPolicy}</strong>
            <span>{handoff.requiredForModelLoopOwnerChange ? copy.handoffOwnerChangeRequired : "—"}</span>
            <span>{handoff.sameOwnerResumeRequiresHandoff ? "—" : copy.handoffSameOwnerResumeNotRequired}</span>
            <KeyValue label={copy.handoffArtifact} value={handoff.recommendedArtifact} code />
          </div>
        </article>

        <article className="project-cockpit-card">
          <CardHeading icon={<CodeOutlined />} title={copy.projectCapabilitiesCard} />
          <div className="project-cockpit-card__section">
            <strong>{copy.mcpApplicability}</strong>
            <div className="project-cockpit-card__tags">
              <Tag color={observationColor(mcpApplicability.observation.status)}>
                {copy.mcpObservation}: {observationLabel(mcpApplicability.observation.status, copy)}
              </Tag>
              {mcpApplicability.source ? <Tag>{copy.mcpEffectiveConfig}</Tag> : null}
            </div>
          </div>
          <div className="project-cockpit-metrics">
            <Metric label={copy.mcpConfigured} value={mcpApplicability.configuredServerCount} />
            <Metric label={copy.mcpApplicable} value={mcpApplicability.applicableServerCount} />
            <Metric label={copy.mcpDisabled} value={mcpApplicability.disabledServerCount} />
          </div>
          <div className="project-cockpit-server-list">
            {mcpApplicability.servers.map((server) => (
              <span key={server.name}>
                <code>{server.name}</code>
                <Tag color={server.enabled ? "success" : "default"}>
                  {server.enabled ? copy.mcpServerEnabled : copy.mcpServerDisabled}
                </Tag>
              </span>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function CardHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <header className="project-cockpit-card__heading">
      <span className="project-cockpit-card__icon">{icon}</span>
      <strong>{title}</strong>
    </header>
  );
}

function KeyValue({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <div className="project-cockpit-kv">
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="project-cockpit-metric">
      <strong>{value ?? "—"}</strong>
      <span>{label}</span>
    </div>
  );
}

function observationLabel(
  status: ProjectDevelopmentObservationStatus,
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  if (status === "ready") return copy.observationReady;
  if (status === "degraded") return copy.observationDegraded;
  return copy.observationNotRequired;
}

function workspaceModeLabel(
  mode: ContinuityProjectDetailResponse["developmentCoordination"]["workspaceExecution"]["mode"],
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  if (mode === "native-checkout") return copy.workspaceNativeCheckout;
  if (mode === "worktree") return copy.workspaceWorktree;
  return "—";
}

function workspaceStateLabel(
  status: string | null,
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  if (status === "ready") return copy.statusReady;
  if (status === "missing") return copy.statusMissing;
  if (status === "blocked") return copy.statusBlocked;
  if (status === "archived") return copy.statusArchived;
  return "—";
}

function modelLoopOwnerLabel(
  ownership: ContinuityProjectDetailResponse["developmentCoordination"]["modelLoopOwnership"],
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  switch (ownership.defaultOwner) {
    case "caller":
      return copy.modelLoopCaller;
  }
}

function runtimeAvailabilityLabel(
  status: ProjectCodexRuntimeAvailability,
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  if (status === "available") return copy.codexAvailable;
  if (status === "unavailable") return copy.codexUnavailable;
  return copy.codexUnknown;
}

function codexActionLabel(
  action: ProjectCodexNextAction,
  copy: ReturnType<typeof getUiCopy>["continuity"]
): string {
  if (action === "resume-native") return copy.codexActionResume;
  if (action === "start-native") return copy.codexActionStart;
  if (action === "repair-workspace") return copy.codexActionRepair;
  return copy.codexActionUnavailable;
}

function threadLabel(
  thread: ContinuityProjectDetailResponse["developmentCoordination"]["codexContinuity"]["matchingThread"],
  emptyLabel: string
): string {
  if (!thread) return emptyLabel;
  return thread.name?.trim() || thread.threadSource?.trim() || thread.sourceKind?.trim() || thread.id.slice(0, 12);
}
