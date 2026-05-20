import { Button, Layout, Segmented } from "antd";
import { Text, Tooltip } from "@lobehub/ui";
import type { ThemeMode } from "antd-style";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ApiOutlined,
  DashboardOutlined,
  ReloadOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import {
  fetchHealth,
  fetchJob,
  fetchJobArtifactContent,
  fetchJobArtifacts,
  fetchJobs
} from "./api";
import tokenPilotLogo from "./assets/tokenpilot-logo.svg";
import { DashboardView } from "./components/DashboardView";
import { StateNotice } from "./components/StateNotice";
import { TokenBar } from "./components/TokenBar";
import type { HealthModel, JobSummary } from "./types";
import { countJobs, summarizeJob } from "./utils";
import {
  getUiCopy,
  LOCALE_STORAGE_KEY,
  localeOptions,
  type LocaleCode
} from "./i18n";
import { themeLabels, type TokenPilotAppearance } from "./theme";
import type { ApiProblem } from "./types";

const SESSION_TOKEN_KEY = "tokenpilot:web:bearer-token";
const JobsView = lazy(() =>
  import("./components/JobsView").then((module) => ({ default: module.JobsView }))
);
const GptHelperView = lazy(() =>
  import("./components/GptHelperView").then((module) => ({ default: module.GptHelperView }))
);

type ViewKey = "dashboard" | "jobs" | "gpt-helper";

interface AppProps {
  appearance: TokenPilotAppearance;
  themeMode: ThemeMode;
  onThemeModeChange: (themeMode: ThemeMode) => void;
}

const INITIAL_HEALTH: HealthModel = {
  ok: false,
  mode: "loading",
  authRequired: false,
  exposed: false,
  openapiUrl: "",
  publicBaseUrl: null
};

function ViewLoadingState({
  title,
  description,
  retryLabel
}: {
  title: string;
  description: string;
  retryLabel: string;
}) {
  return (
    <div className="view-stack">
      <StateNotice
        kind="loading"
        title={title}
        description={description}
        retryLabel={retryLabel}
      />
    </div>
  );
}

export default function App({ appearance, themeMode, onThemeModeChange }: AppProps) {
  const [locale, setLocale] = useState<LocaleCode>(() =>
    typeof window === "undefined"
      ? "zh-CN"
      : ((sessionStorage.getItem(LOCALE_STORAGE_KEY) as LocaleCode | null) ?? "zh-CN")
  );
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(SESSION_TOKEN_KEY)
  );
  const [health, setHealth] = useState<HealthModel>(INITIAL_HEALTH);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const copy = getUiCopy(locale);

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    if (!healthLoading) {
      void loadJobs(token, health.authRequired, activeView === "jobs");
    }
  }, [healthLoading, token, locale, health.authRequired]);

  useEffect(() => {
    if (activeView === "jobs" && selectedJobId) {
      void loadJobDetail(selectedJobId, token);
    }
  }, [activeView, selectedJobId, token]);

  useEffect(() => {
    document.title = copy.pageTitle;
  }, [copy.pageTitle]);

  function getErrorMessage(error: unknown): string {
    if (!error) {
      return copy.notices.bootstrapFailedTitle;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const apiProblem = error as ApiProblem;
      return typeof apiProblem.message === "string"
        ? apiProblem.message
        : String(apiProblem.message ?? error);
    }
    return String(error);
  }

  async function loadHealth() {
    setHealthLoading(true);
    setHealthError(null);

    try {
      const healthResponse = await fetchHealth();
      setHealth(healthResponse);
    } catch (error) {
      setHealthError(getErrorMessage(error));
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadJobs(
    currentToken: string | null,
    authRequired = health.authRequired,
    hydrateDetail = activeView === "jobs"
  ) {
    if (authRequired && !currentToken?.trim()) {
      setJobs([]);
      setJobsError(null);
      setJobsLoading(false);
      setSelectedJobId(null);
      setSelectedArtifactKey(null);
      setArtifactContent(null);
      setArtifactError(null);
      return;
    }

    setJobsLoading(true);
    setJobsError(null);

    try {
      const response = await fetchJobs(currentToken);
      const summarized = response.jobs.map((job) => summarizeJob(job, locale));
      setJobs(summarized);

      const preferredId = selectedJobId && summarized.some((job) => job.id === selectedJobId)
        ? selectedJobId
        : summarized[0]?.id;

      if (preferredId) {
        setSelectedJobId(preferredId);
        if (hydrateDetail) {
          void loadJobDetail(preferredId, currentToken, summarized);
        }
      } else {
        setSelectedJobId(null);
        setSelectedArtifactKey(null);
        setArtifactContent(null);
        setArtifactError(null);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setJobsError(message);
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }

  async function loadJobDetail(
    jobId: string,
    currentToken: string | null,
    currentJobs = jobs
  ) {
    setDetailLoading(true);

    try {
      const response = await fetchJob(jobId, currentToken);
      let detailSource = response.job;
      try {
        const artifactResponse = await fetchJobArtifacts(jobId, currentToken);
        detailSource = {
          ...response.job,
          artifacts: artifactResponse.artifacts
        };
      } catch {
        // keep the detail view available even when artifact metadata is temporarily unavailable
      }
      const detail = summarizeJob(detailSource, locale);
      setJobs(currentJobs.map((job) => (job.id === jobId ? detail : job)));
      const firstArtifactKey = detail.artifacts?.[0]?.key ?? null;
      setSelectedArtifactKey(firstArtifactKey);
      if (firstArtifactKey) {
        void loadArtifactContent(jobId, firstArtifactKey, currentToken);
      } else {
        setArtifactContent(null);
        setArtifactError(null);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setJobsError(message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadArtifactContent(
    jobId: string,
    artifactKey: string,
    currentToken: string | null
  ) {
    setArtifactLoading(true);
    setArtifactError(null);

    try {
      const response = await fetchJobArtifactContent(jobId, artifactKey, currentToken);
      setArtifactContent(response.content);
    } catch (error) {
      setArtifactContent(null);
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  }

  function saveToken(nextToken: string) {
    const normalized = nextToken.trim();
    if (!normalized) {
      return;
    }
    sessionStorage.setItem(SESSION_TOKEN_KEY, normalized);
    setToken(normalized);
  }

  function clearToken() {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setToken(null);
  }

  function updateLocale(nextLocale: LocaleCode) {
    sessionStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    setLocale(nextLocale);
  }

  const counts = countJobs(jobs);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  if (healthLoading) {
    return (
      <div className="app-shell">
        <StateNotice
          kind="loading"
          title={copy.notices.loadingConsoleTitle}
          description={copy.notices.loadingConsoleDescription}
          retryLabel={copy.common.retry}
        />
      </div>
    );
  }

  if (healthError) {
    return (
      <div className="app-shell">
        <StateNotice
          kind="error"
          title={copy.notices.bootstrapFailedTitle}
          description={healthError}
          retryLabel={copy.common.retry}
          onRetry={() => void loadHealth()}
        />
      </div>
    );
  }

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__top">
            <div className="app-header__masthead">
              <div className="app-header__brand">
                <img className="app-header__logo" src={tokenPilotLogo} alt="" aria-hidden="true" />
                <div className="app-header__copy">
                  <Text as="div" className="app-header__title">
                    {copy.header.title}
                  </Text>
                  <Text as="div" type="secondary" className="app-header__subtitle">
                    {copy.header.subtitle}
                  </Text>
                </div>
              </div>
            </div>
            <div className="app-toolbar panel">
              <div className="app-toolbar__group">
                <Segmented<LocaleCode>
                  value={locale}
                  onChange={(value) => updateLocale(value)}
                  options={localeOptions}
                />
              </div>
              <div className="app-toolbar__group">
                <Segmented<ViewKey>
                  value={activeView}
                  onChange={(value) => setActiveView(value)}
                  options={[
                    { label: copy.header.dashboard, value: "dashboard", icon: <DashboardOutlined /> },
                    { label: copy.header.jobs, value: "jobs", icon: <UnorderedListOutlined /> },
                    { label: copy.header.gptHelper, value: "gpt-helper", icon: <ApiOutlined /> }
                  ]}
                />
              </div>
              <div className="app-toolbar__group">
                <span className="sr-only" id="tokenpilot-theme-mode-label">
                  {copy.header.themeModeLabel}
                </span>
                <Segmented<ThemeMode>
                  aria-labelledby="tokenpilot-theme-mode-label"
                  className="theme-switch"
                  value={themeMode}
                  onChange={(value) => onThemeModeChange(value)}
                  options={[
                    { label: themeLabels[locale].auto, value: "auto" },
                    { label: themeLabels[locale].dark, value: "dark" },
                    { label: themeLabels[locale].light, value: "light" }
                  ]}
                />
              </div>
              <div className="app-toolbar__group app-toolbar__group--action">
                <Tooltip title={copy.header.refreshTooltip}>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      void loadHealth();
                      void loadJobs(token, health.authRequired, activeView === "jobs");
                    }}
                    loading={jobsLoading || healthLoading}
                  >
                    {copy.header.refresh}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </Layout.Header>

      <Layout.Content className="app-content">
        <TokenBar
          locale={locale}
          authRequired={health.authRequired}
          token={token}
          onSave={(value) => {
            saveToken(value);
            void loadJobs(value, health.authRequired, activeView === "jobs");
          }}
          onClear={() => {
            clearToken();
            void loadJobs(null, health.authRequired, activeView === "jobs");
          }}
        />

        {activeView === "dashboard" ? (
          <DashboardView
            locale={locale}
            health={health}
            counts={counts}
            recentJobs={jobs.slice(0, 5)}
            onSelectJob={(jobId) => {
              setSelectedJobId(jobId);
              setActiveView("jobs");
              void loadJobDetail(jobId, token);
            }}
            onOpenGptHelper={() => setActiveView("gpt-helper")}
            onRefresh={() => {
              void loadHealth();
              void loadJobs(token, health.authRequired, false);
            }}
          />
        ) : null}

        {activeView === "jobs" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.jobs.loadingTitle}
                description={copy.jobs.loadingDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <JobsView
              locale={locale}
              authRequired={health.authRequired}
              hasToken={Boolean(token)}
              jobs={jobs}
              selectedJob={selectedJob}
              loading={jobsLoading}
              detailLoading={detailLoading}
              artifactLoading={artifactLoading}
              artifactError={artifactError}
              artifactContent={artifactContent}
              selectedArtifactKey={selectedArtifactKey}
              error={jobsError}
              onRefresh={() => void loadJobs(token, health.authRequired, true)}
              onSelectJob={(jobId) => {
                setSelectedJobId(jobId);
                void loadJobDetail(jobId, token);
              }}
              onSelectArtifact={(artifactKey) => {
                if (!selectedJobId) return;
                setSelectedArtifactKey(artifactKey);
                void loadArtifactContent(selectedJobId, artifactKey, token);
              }}
            />
          </Suspense>
        ) : null}

        {activeView === "gpt-helper" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.gpt.snapshotTitle}
                description={copy.gpt.snapshotDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <GptHelperView locale={locale} health={health} />
          </Suspense>
        ) : null}
      </Layout.Content>
    </Layout>
  );
}
