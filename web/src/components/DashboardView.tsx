import { Button, List, Tag } from "antd";
import { Text } from "@lobehub/ui";
import type {
  HealthModel,
  JobCounts,
  JobSummary,
  RepoGovernanceEntry,
  RepoGovernanceModel
} from "../types";
import { formatDateTime } from "../utils";
import { SectionCard } from "./SectionCard";
import type { LocaleCode } from "../i18n";
import { getStatusLabel, getTypeLabel, getUiCopy } from "../i18n";

interface DashboardViewProps {
  locale: LocaleCode;
  health: HealthModel;
  repoGovernance?: RepoGovernanceModel;
  counts: JobCounts;
  recentJobs: JobSummary[];
  jobsProtected: boolean;
  onSelectJob: (jobId: string) => void;
  onOpenGptHelper: () => void;
  onRefresh: () => void;
}

export function DashboardView({
  locale,
  health,
  repoGovernance,
  counts,
  recentJobs,
  jobsProtected,
  onSelectJob,
  onOpenGptHelper,
  onRefresh
}: DashboardViewProps) {
  const throughput = counts.total ? Math.round((counts.completed / counts.total) * 100) : 0;
  const copy = getUiCopy(locale);
  const hasAnyJobs = counts.total > 0;
  const capabilityLabels = {
    pack: copy.dashboard.repoCapabilityPack,
    "files-read": copy.dashboard.repoCapabilityFilesRead,
    "codex-run": copy.dashboard.repoCapabilityCodexRun
  } as const;
  const sourceLabels = {
    default: copy.dashboard.repoSourceDefault,
    "default-sibling": copy.dashboard.repoSourceDefaultSibling,
    "local-config": copy.dashboard.repoSourceLocalConfig
  } as const;

  function renderRepoStatus(repo: RepoGovernanceEntry) {
    if (repo.status === "enabled") {
      return <Tag color="success">{copy.status.healthOk}</Tag>;
    }
    if (repo.status === "blocked") {
      return <Tag color="error">{copy.status.failed}</Tag>;
    }
    return <Tag>{copy.common.notAvailable}</Tag>;
  }

  return (
    <div className="view-stack">
      <SectionCard
        title={copy.dashboard.summaryTitle}
        description={copy.dashboard.summaryDescription}
        tone="default"
        extra={
          <div className="summary-flags summary-flags--desktop">
            <Tag color={health.ok ? "success" : "default"}>
              {copy.dashboard.healthLabel} · {health.ok ? copy.status.healthOk : copy.status.healthBad}
            </Tag>
            <Tag color={health.authRequired ? "warning" : "default"}>
              {copy.dashboard.authRequiredLabel} · {health.authRequired ? copy.status.yes : copy.status.no}
            </Tag>
            <Tag color={health.exposed ? "processing" : "default"}>
              {copy.dashboard.exposedLabel} · {health.exposed ? copy.status.yes : copy.status.no}
            </Tag>
          </div>
        }
      >
        <div className="summary-inline-status">
          <span>{copy.dashboard.healthLabel} · {health.ok ? copy.status.healthOk : copy.status.healthBad}</span>
          <span>{copy.dashboard.authRequiredLabel} · {health.authRequired ? copy.status.yes : copy.status.no}</span>
          <span>{copy.dashboard.exposedLabel} · {health.exposed ? copy.status.yes : copy.status.no}</span>
        </div>
        <div className="section-note section-note--warning">
          <strong>{copy.dashboard.boundaryTitle}</strong>
          <span>{copy.dashboard.boundaryDescription}</span>
        </div>
        <div className="summary-grid summary-grid--single">
          <div className="summary-primary">
            <div className="summary-line">
              <span>{copy.dashboard.modeCard}</span>
              <strong>{health.mode}</strong>
            </div>
            <div className="summary-line">
              <span>{copy.dashboard.authCard}</span>
              <strong>
                {health.authRequired ? copy.status.authRequired : copy.status.authOpen}
              </strong>
            </div>
            <div className="summary-line summary-line--wide">
              <span>{copy.dashboard.openapiLabel}</span>
              <strong>{health.openapiUrl}</strong>
            </div>
            <div className="summary-line summary-line--wide">
              <span>{copy.dashboard.publicBaseUrlLabel}</span>
              <strong>{health.publicBaseUrl ?? copy.common.notAvailable}</strong>
            </div>
          </div>
        </div>
      </SectionCard>

      {repoGovernance ? (
        <SectionCard
          title={copy.dashboard.repoGovernanceTitle}
          description={copy.dashboard.repoGovernanceDescription}
          extra={<Tag>{copy.dashboard.repoGovernancePathHidden}</Tag>}
        >
          <div className="repo-governance">
            <div className="repo-governance__meta">
              <span>{copy.dashboard.repoGovernanceConfigScope}</span>
              <strong>{repoGovernance.defaultRepoId}</strong>
            </div>
            <div className="repo-governance__grid">
              {repoGovernance.repos.map((repo) => (
                <div key={repo.repoId} className={`repo-card repo-card--${repo.status}`}>
                  <div className="repo-card__header">
                    <div className="repo-card__title">
                      <strong>{repo.repoId}</strong>
                      {repo.defaultRepo ? (
                        <Tag color="processing">{copy.dashboard.repoGovernanceDefaultLabel}</Tag>
                      ) : null}
                    </div>
                    {renderRepoStatus(repo)}
                  </div>
                  <div className="repo-card__source">
                    {sourceLabels[repo.source]}
                    {" · "}
                    {copy.dashboard.repoGovernancePathHidden}
                  </div>
                  {repo.capabilities.length ? (
                    <div className="repo-card__capabilities">
                      {repo.capabilities.map((capability) => (
                        <Tag key={capability}>{capabilityLabels[capability]}</Tag>
                      ))}
                    </div>
                  ) : (
                    <div className="repo-card__warning">
                      {repo.status === "blocked"
                        ? copy.dashboard.repoGovernanceBlockedHint
                        : copy.dashboard.repoGovernanceMissingHint}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title={copy.dashboard.distributionTitle} description={copy.dashboard.distributionDescription}>
        <div className="distribution-stack">
          {jobsProtected ? (
            <div className="distribution-empty-card">
              <div className="metric-inline metric-inline--compact metric-inline--muted">
                <div className="metric-inline__item"><span>{copy.dashboard.queued}</span><strong>--</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.running}</span><strong>--</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.failed}</span><strong>--</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.total}</span><strong>--</strong></div>
              </div>

              <div className="empty-console empty-console--protected">
                <div className="empty-console__copy">
                  <strong>{copy.dashboard.protectedStateTitle}</strong>
                  <span>{copy.dashboard.protectedStateDescription}</span>
                </div>
                <div className="empty-console__actions">
                  <Button type="link" onClick={onRefresh}>
                    {copy.dashboard.quickActionRefresh}
                  </Button>
                </div>
              </div>
            </div>
          ) : hasAnyJobs ? (
            <div className="metric-grid">
              <div className="metric-chip"><span>{copy.dashboard.queued}</span><strong>{counts.queued}</strong></div>
              <div className="metric-chip"><span>{copy.dashboard.running}</span><strong>{counts.running}</strong></div>
              <div className="metric-chip"><span>{copy.dashboard.failed}</span><strong>{counts.failed}</strong></div>
              <div className="metric-chip"><span>{copy.dashboard.total}</span><strong>{counts.total}</strong></div>
            </div>
          ) : (
            <div className="distribution-empty-card">
              <div className="metric-inline metric-inline--compact">
                <div className="metric-inline__item"><span>{copy.dashboard.queued}</span><strong>{counts.queued}</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.running}</span><strong>{counts.running}</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.failed}</span><strong>{counts.failed}</strong></div>
                <div className="metric-inline__item"><span>{copy.dashboard.total}</span><strong>{counts.total}</strong></div>
              </div>

              <div className="empty-console">
                <div className="empty-console__copy">
                  <strong>{copy.dashboard.emptyStateTitle}</strong>
                  <span>{copy.dashboard.emptyStateDescription}</span>
                </div>
                <div className="empty-console__actions">
                  <Button type="link" onClick={onRefresh}>
                    {copy.dashboard.quickActionRefresh}
                  </Button>
                  <Button onClick={onOpenGptHelper}>
                    {copy.dashboard.quickActionGpt}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {hasAnyJobs ? (
            <div className="progress-wrap">
              <div className="progress-label">{copy.dashboard.completionRatio}</div>
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={throughput}
                aria-label={copy.dashboard.completionRatio}
              >
                <div className="progress-bar__fill" style={{ width: `${throughput}%` }} />
              </div>
            </div>
          ) : null}

          {recentJobs.length ? (
            <div className="recent-inline">
              <List
                dataSource={recentJobs}
                renderItem={(job) => (
                  <List.Item
                    actions={[
                      <Button key={job.id} type="link" onClick={() => onSelectJob(job.id)}>
                        {copy.common.inspect}
                      </Button>
                    ]}
                  >
                    <List.Item.Meta
                      title={`${job.headline} · ${getTypeLabel(locale, job.type)}`}
                      description={`${getStatusLabel(locale, job.status)} · ${copy.dashboard.recentJobUpdatedPrefix} ${formatDateTime(job.updatedAt)} · ${job.id}`}
                    />
                  </List.Item>
                )}
              />
            </div>
          ) : null}
        </div>
      </SectionCard>

    </div>
  );
}
