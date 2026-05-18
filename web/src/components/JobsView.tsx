import { Button, Descriptions, List, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { LockOutlined } from "@ant-design/icons";
import type { JobSummary } from "../types";
import { formatDateTime, safePathList, safeText } from "../utils";
import { SectionCard } from "./SectionCard";
import { StateNotice } from "./StateNotice";
import type { LocaleCode } from "../i18n";
import { getStatusLabel, getTypeLabel, getUiCopy } from "../i18n";

interface JobsViewProps {
  locale: LocaleCode;
  authRequired: boolean;
  hasToken: boolean;
  jobs: JobSummary[];
  selectedJob: JobSummary | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  onSelectJob: (jobId: string) => void;
  onRefresh: () => void;
}

function renderStatus(status: JobSummary["status"], label: string) {
  const colorMap = {
    queued: "default",
    running: "processing",
    completed: "success",
    failed: "error"
  } as const;

  return <Tag color={colorMap[status]}>{label}</Tag>;
}

function buildRows(
  job: JobSummary | null,
  locale: LocaleCode
): Array<{ label: string; value: string | string[] }> {
  if (!job) return [];
  const copy = getUiCopy(locale);

  const paths =
    safePathList(job.result?.publicIncludeEntries, locale) ||
    safePathList(job.result?.sourceFiles, locale) ||
    safePathList(job.result?.paths, locale);

  return [
    { label: copy.jobs.rowType, value: getTypeLabel(locale, job.type) },
    { label: copy.jobs.rowStatus, value: getStatusLabel(locale, job.status) },
    { label: copy.jobs.rowCreated, value: formatDateTime(job.createdAt) },
    { label: copy.jobs.rowUpdated, value: formatDateTime(job.updatedAt) },
    { label: copy.jobs.rowHeadline, value: job.headline },
    { label: copy.jobs.rowError, value: safeText(job.error, locale) || copy.common.none },
    { label: copy.jobs.rowArtifacts, value: paths.length ? paths : [copy.common.none] }
  ];
}

export function JobsView({
  locale,
  authRequired,
  hasToken,
  jobs,
  selectedJob,
  loading,
  detailLoading,
  error,
  onSelectJob,
  onRefresh
}: JobsViewProps) {
  const copy = getUiCopy(locale);

  if (authRequired && !hasToken && !jobs.length) {
    return (
      <SectionCard
        title={copy.jobs.sectionTitle}
        description={copy.jobs.authRequiredSectionDescription}
        extra={
          <Tag color="warning">
            {copy.status.authRequired}
          </Tag>
        }
      >
        <div className="jobs-gate">
          <div className="jobs-gate__status">
            <div className="compact-error__icon" aria-hidden="true">
              <LockOutlined />
            </div>
            <div className="jobs-gate__copy">
              <strong>{copy.jobs.authRequiredTitle}</strong>
              <p>{copy.jobs.authRequiredBody}</p>
            </div>
          </div>
          <div className="jobs-gate__next">
            <span>{copy.jobs.authRequiredNextLabel}</span>
            <strong>{copy.jobs.authRequiredNextValue}</strong>
          </div>
          <div className="jobs-gate__facts">
            <div className="jobs-gate__fact">
              <span>{copy.jobs.authRequiredScopeLabel}</span>
              <strong>{copy.jobs.authRequiredScopeValue}</strong>
            </div>
            <div className="jobs-gate__fact">
              <span>{copy.jobs.authRequiredSessionLabel}</span>
              <strong>{copy.jobs.authRequiredSessionValue}</strong>
            </div>
            <div className="jobs-gate__fact">
              <span>{copy.jobs.authRequiredStatusLabel}</span>
              <strong>{copy.status.authRequired}</strong>
            </div>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (loading && !jobs.length) {
    return (
      <SectionCard title={copy.jobs.sectionTitle}>
        <StateNotice
          kind="loading"
          title={copy.jobs.loadingTitle}
          description={copy.jobs.loadingDescription}
          retryLabel={copy.common.retry}
        />
      </SectionCard>
    );
  }

  if (error && !jobs.length) {
    return (
      <SectionCard title={copy.jobs.sectionTitle}>
        <div className="compact-error">
          <div className="compact-error__icon" aria-hidden="true">
            <LockOutlined />
          </div>
          <div className="compact-error__body">
            <strong>{copy.jobs.requestFailedTitle}</strong>
            <p>{error}</p>
          </div>
          <Button type="primary" onClick={onRefresh}>
            {copy.common.retry}
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (!jobs.length) {
    return (
      <SectionCard title={copy.jobs.sectionTitle}>
        <StateNotice
          kind="empty"
          title={copy.jobs.emptyTitle}
          description={copy.jobs.emptyDescription}
          retryLabel={copy.common.retry}
        />
      </SectionCard>
    );
  }

  const detailRows = buildRows(selectedJob, locale);
  const columns: ColumnsType<JobSummary> = [
    {
      title: copy.jobs.columnHeadline,
      dataIndex: "headline",
      key: "headline",
      render: (_, job) => (
        <div>
          <div className="jobs-table__headline">{job.headline}</div>
          <div className="jobs-table__subline">{job.id}</div>
        </div>
      )
    },
    {
      title: copy.jobs.columnType,
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (value: JobSummary["type"]) => getTypeLabel(locale, value)
    },
    {
      title: copy.jobs.columnStatus,
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: JobSummary["status"]) => renderStatus(value, getStatusLabel(locale, value))
    },
    {
      title: copy.jobs.columnUpdated,
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value: string) => formatDateTime(value)
    }
  ];

  return (
    <div className="jobs-layout">
      <SectionCard
        title={copy.jobs.queueTitle}
        description={copy.jobs.queueDescription}
        extra={
          <Button onClick={onRefresh} loading={loading}>
            {copy.common.refresh}
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={jobs}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          rowClassName={(record) => (record.id === selectedJob?.id ? "jobs-table__row--active" : "")}
          onRow={(record) => ({
            onClick: () => onSelectJob(record.id)
          })}
        />
      </SectionCard>

      <SectionCard title={copy.jobs.detailTitle} description={copy.jobs.detailDescription}>
        {selectedJob ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {detailLoading ? <div className="detail-loading">{copy.jobs.detailRefreshing}</div> : null}
            <Descriptions column={1} size="small">
              {detailRows.map((row) => (
                <Descriptions.Item key={row.label} label={row.label}>
                  {Array.isArray(row.value) ? (
                    <List
                      size="small"
                      dataSource={row.value}
                      renderItem={(item) => <List.Item>{item}</List.Item>}
                    />
                  ) : row.label === copy.jobs.rowStatus ? (
                    renderStatus(selectedJob.status, getStatusLabel(locale, selectedJob.status))
                  ) : (
                    row.value
                  )}
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Space>
        ) : (
          <StateNotice
            kind="empty"
            title={copy.jobs.noSelectionTitle}
            description={copy.jobs.noSelectionDescription}
            retryLabel={copy.common.retry}
          />
        )}
      </SectionCard>
    </div>
  );
}
