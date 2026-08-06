import { Button, Layout, Segmented } from "antd";
import { Text, Tooltip } from "@lobehub/ui";
import type { ThemeMode } from "antd-style";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ApiOutlined,
  ApartmentOutlined,
  DashboardOutlined,
  ReloadOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import {
  controlJob,
  fetchGptConfig,
  fetchHealth,
  fetchJob,
  fetchJobArtifactContent,
  fetchJobArtifacts,
  fetchJobs,
  fetchSetupStatus,
  terminateAllJobs
} from "./api";
import tokenPilotLogo from "./assets/tokenpilot-logo.svg";
import { DashboardView } from "./components/DashboardView";
import { SetupWizardView } from "./components/SetupWizardView";
import { StateNotice } from "./components/StateNotice";
import { TokenBar } from "./components/TokenBar";
import type {
  ArtifactPreviewState,
  ContinuitySectionKey,
  GptConfigModel,
  HealthModel,
  JobSummary,
  SetupStatusResponse
} from "./types";
import { countJobs, summarizeJob } from "./utils";
import {
  getUiCopy,
  LOCALE_STORAGE_KEY,
  localeOptions,
  type LocaleCode
} from "./i18n";
import { themeLabels } from "./theme";
import type { ApiProblem } from "./types";

const SESSION_TOKEN_KEY = "tokenpilot:web:bearer-token";
const JobsView = lazy(() =>
  import("./components/JobsView").then((module) => ({ default: module.JobsView }))
);
const GptHelperView = lazy(() =>
  import("./components/GptHelperView").then((module) => ({ default: module.GptHelperView }))
);
const ContinuityWorkbenchView = lazy(() =>
  import("./components/continuity/ContinuityWorkbenchView").then((module) => ({
    default: module.ContinuityWorkbenchView
  }))
);

type ViewKey = "dashboard" | "continuity" | "jobs" | "gpt-helper";

interface AppProps {
  themeMode: ThemeMode;
  onThemeModeChange: (themeMode: ThemeMode) => void;
}

const VIEW_PATHS: Record<ViewKey, string> = {
  dashboard: "/ui",
  continuity: "/ui/continuity",
  jobs: "/ui/jobs",
  "gpt-helper": "/ui/gpt-helper"
};

const CONTINUITY_SECTIONS = new Set<ContinuitySectionKey>([
  "projects",
  "documents",
  "tasks",
  "sessions",
  "handoffs",
  "evidence",
  "approvals"
]);

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

function parseRoute(): {
  view: ViewKey;
  jobId: string | null;
  continuitySection: ContinuitySectionKey;
} {
  if (typeof window === "undefined") {
    return { view: "dashboard", jobId: null, continuitySection: "projects" };
  }

  const pathname = window.location.pathname.replace(/\/+$/, "") || "/ui";
  if (pathname === "/ui/jobs" || pathname.startsWith("/ui/jobs/")) {
    const jobId = pathname.startsWith("/ui/jobs/")
      ? decodeURIComponent(pathname.slice("/ui/jobs/".length))
      : null;
    return { view: "jobs", jobId: jobId || null, continuitySection: "projects" };
  }
  if (
    pathname === "/ui/continuity" ||
    pathname.startsWith("/ui/continuity/")
  ) {
    const candidate = pathname.startsWith("/ui/continuity/")
      ? decodeURIComponent(pathname.slice("/ui/continuity/".length))
      : "projects";
    const continuitySection = CONTINUITY_SECTIONS.has(
      candidate as ContinuitySectionKey
    )
      ? (candidate as ContinuitySectionKey)
      : "projects";
    return { view: "continuity", jobId: null, continuitySection };
  }
  if (pathname === "/ui/gpt-helper") {
    return { view: "gpt-helper", jobId: null, continuitySection: "projects" };
  }
  return { view: "dashboard", jobId: null, continuitySection: "projects" };
}

export default function App({ themeMode, onThemeModeChange }: AppProps) {
  const [locale, setLocale] = useState<LocaleCode>(() =>
    typeof window === "undefined"
      ? "zh-CN"
      : ((sessionStorage.getItem(LOCALE_STORAGE_KEY) as LocaleCode | null) ?? "zh-CN")
  );
  const [activeView, setActiveView] = useState<ViewKey>(() => parseRoute().view);
  const [activeContinuitySection, setActiveContinuitySection] =
    useState<ContinuitySectionKey>(() => parseRoute().continuitySection);
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(SESSION_TOKEN_KEY)
  );
  const [health, setHealth] = useState<HealthModel>(INITIAL_HEALTH);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [gptConfig, setGptConfig] = useState<GptConfigModel | null>(null);
  const [gptConfigError, setGptConfigError] = useState<string | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => parseRoute().jobId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewState | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [controlLoading, setControlLoading] = useState(false);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const copy = getUiCopy(locale);

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    function onPopState() {
      const route = parseRoute();
      setActiveView(route.view);
      setSelectedJobId(route.jobId);
      setActiveContinuitySection(route.continuitySection);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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
      try {
        const setupResponse = await fetchSetupStatus(token);
        setSetupStatus(setupResponse);
      } catch {
        setSetupStatus(null);
      }
      try {
        const gptConfigResponse = await fetchGptConfig(token);
        setGptConfig(gptConfigResponse.config);
        setGptConfigError(null);
      } catch (error) {
        setGptConfig(null);
        setGptConfigError(getErrorMessage(error));
      }
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
      setArtifactPreview(null);
      setArtifactError(null);
      return;
    }

    setJobsLoading(true);
    setJobsError(null);

    try {
      const response = await fetchJobs(currentToken, { limit: 20, includeResult: false });
      const summarized = response.jobs.map((job) => summarizeJob(job, locale));
      setJobs(summarized);

      const hasSelectedJob = Boolean(
        selectedJobId && summarized.some((job) => job.id === selectedJobId)
      );
      const preferredId = hasSelectedJob ? selectedJobId : summarized[0]?.id;

      if (preferredId) {
        setSelectedJobId(preferredId);
        if (activeView === "jobs" && typeof window !== "undefined") {
          const nextPath = `${VIEW_PATHS.jobs}/${encodeURIComponent(preferredId)}`;
          if (window.location.pathname === VIEW_PATHS.jobs || !hasSelectedJob) {
            window.history.replaceState(null, "", nextPath);
          }
        }
        if (hydrateDetail) {
          void loadJobDetail(preferredId, currentToken, summarized);
        }
      } else {
        setSelectedJobId(null);
        setSelectedArtifactKey(null);
        setArtifactPreview(null);
        setArtifactError(null);
        if (activeView === "jobs" && typeof window !== "undefined") {
          if (window.location.pathname !== VIEW_PATHS.jobs) {
            window.history.replaceState(null, "", VIEW_PATHS.jobs);
          }
        }
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
        setArtifactPreview(null);
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
      const response = await fetchJobArtifactContent(jobId, artifactKey, undefined, currentToken);
      setArtifactPreview({
        content: response.file.content,
        nextOffset: response.file.nextOffset,
        eof: response.file.eof
      });
    } catch (error) {
      setArtifactPreview(null);
      setArtifactError(getErrorMessage(error));
    } finally {
      setArtifactLoading(false);
    }
  }

  async function loadMoreArtifactContent() {
    if (!selectedJobId || !selectedArtifactKey || !artifactPreview?.nextOffset) {
      return;
    }

    setArtifactLoading(true);
    setArtifactError(null);

    try {
      const response = await fetchJobArtifactContent(
        selectedJobId,
        selectedArtifactKey,
        { offset: artifactPreview.nextOffset },
        token
      );
      setArtifactPreview({
        content: `${artifactPreview.content}${response.file.content}`,
        nextOffset: response.file.nextOffset,
        eof: response.file.eof
      });
    } catch (error) {
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

  function navigateView(
    nextView: ViewKey,
    jobId?: string | null,
    continuitySection?: ContinuitySectionKey
  ) {
    setActiveView(nextView);
    const nextJobId = nextView === "jobs" ? (jobId ?? selectedJobId) : null;
    const nextContinuitySection =
      nextView === "continuity"
        ? (continuitySection ?? activeContinuitySection)
        : activeContinuitySection;
    if (nextView === "jobs") {
      setSelectedJobId(nextJobId ?? null);
    }
    if (nextView === "continuity") {
      setActiveContinuitySection(nextContinuitySection);
    }

    if (typeof window !== "undefined") {
      const basePath = VIEW_PATHS[nextView];
      const nextPath =
        nextView === "jobs" && nextJobId
          ? `${basePath}/${encodeURIComponent(nextJobId)}`
          : nextView === "continuity"
            ? `${basePath}/${encodeURIComponent(nextContinuitySection)}`
            : basePath;
      if (window.location.pathname !== nextPath) {
        window.history.pushState(null, "", nextPath);
      }
    }
  }

  function navigateContinuitySection(section: ContinuitySectionKey) {
    navigateView("continuity", null, section);
  }

  async function controlSelectedJob(action: "pause" | "resume" | "terminate") {
    if (!selectedJobId) {
      return;
    }

    const targetJobId = selectedJobId;
    setControlLoading(true);
    setControlMessage(null);
    setJobsError(null);

    try {
      const response = await controlJob(targetJobId, action, token);
      setControlMessage(response.message);
      await loadJobDetail(targetJobId, token);
      await loadJobs(token, health.authRequired, false);
    } catch (error) {
      setJobsError(getErrorMessage(error));
    } finally {
      setControlLoading(false);
    }
  }

  async function terminateRunningJobs() {
    setControlLoading(true);
    setControlMessage(null);
    setJobsError(null);

    try {
      await terminateAllJobs(token);
      setControlMessage(copy.jobs.controlTerminateAllComplete);
      await loadJobs(token, health.authRequired, activeView === "jobs");
    } catch (error) {
      setJobsError(getErrorMessage(error));
    } finally {
      setControlLoading(false);
    }
  }

  const counts = countJobs(jobs);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const jobsProtected = health.authRequired && !token?.trim();
  const headerProductVersion = gptConfig?.productVersion ?? __TOKENPILOT_VERSION__.productVersion;
  const headerSchemaVersion = gptConfig?.schemaVersion ?? __TOKENPILOT_VERSION__.schemaVersion;
  const headerBuildVersion = gptConfig?.buildVersion ?? __TOKENPILOT_VERSION__.buildVersion;
  const headerVersionText = headerSchemaVersion
    ? `${headerProductVersion} (${headerSchemaVersion})`
    : headerProductVersion;

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
                    {headerSchemaVersion ? (
                      <>
                        <span>{headerProductVersion}</span>{" "}
                        <Tooltip title={headerBuildVersion ?? headerVersionText}>
                          <span
                            className="version-revision"
                            title={headerBuildVersion ?? headerVersionText}
                          >
                            ({headerSchemaVersion})
                          </span>
                        </Tooltip>
                      </>
                    ) : (
                      headerVersionText
                    )}
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
              <div className="app-toolbar__group">
                <Segmented<ViewKey>
                  value={activeView}
                  onChange={(value) => navigateView(value)}
                  options={[
                    { label: copy.header.dashboard, value: "dashboard", icon: <DashboardOutlined /> },
                    { label: copy.header.continuity, value: "continuity", icon: <ApartmentOutlined /> },
                    { label: copy.header.jobs, value: "jobs", icon: <UnorderedListOutlined /> },
                    { label: copy.header.gptHelper, value: "gpt-helper", icon: <ApiOutlined /> }
                  ]}
                />
              </div>
              <div className="app-toolbar__group app-toolbar__group--action">
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
        {activeView === "dashboard" ? (
          <div className="view-stack">
            {setupStatus && !setupStatus.ready ? (
              <SetupWizardView
                locale={locale}
                setupStatus={setupStatus}
                onOpenGptHelper={() => navigateView("gpt-helper")}
                onRefresh={() => void loadHealth()}
              />
            ) : null}
            <DashboardView
              locale={locale}
              health={health}
              repoGovernance={gptConfig?.repoGovernance}
              counts={counts}
              recentJobs={jobs.slice(0, 5)}
              jobsProtected={jobsProtected}
              onSelectJob={(jobId) => {
                navigateView("jobs", jobId);
                void loadJobDetail(jobId, token);
              }}
              onOpenGptHelper={() => navigateView("gpt-helper")}
              onRefresh={() => {
                void loadHealth();
                void loadJobs(token, health.authRequired, false);
              }}
            />
          </div>
        ) : null}

        {activeView === "continuity" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.continuity.loadingTitle}
                description={copy.continuity.loadingDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <ContinuityWorkbenchView
              locale={locale}
              token={token}
              authRequired={health.authRequired}
              activeSection={activeContinuitySection}
              onSectionChange={navigateContinuitySection}
            />
          </Suspense>
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
              artifactPreview={artifactPreview}
              selectedArtifactKey={selectedArtifactKey}
              error={jobsError}
              controlLoading={controlLoading}
              controlMessage={controlMessage}
              onRefresh={() => void loadJobs(token, health.authRequired, true)}
              onSelectJob={(jobId) => {
                navigateView("jobs", jobId);
                setControlMessage(null);
                void loadJobDetail(jobId, token);
              }}
              onSelectArtifact={(artifactKey) => {
                if (!selectedJobId) return;
                setSelectedArtifactKey(artifactKey);
                void loadArtifactContent(selectedJobId, artifactKey, token);
              }}
              onLoadMoreArtifact={() => void loadMoreArtifactContent()}
              onControlJob={(action) => void controlSelectedJob(action)}
              onTerminateAll={() => void terminateRunningJobs()}
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
            <GptHelperView
              locale={locale}
              health={health}
              config={gptConfig}
              configError={gptConfigError}
            />
          </Suspense>
        ) : null}
      </Layout.Content>
    </Layout>
  );
}
