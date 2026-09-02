import { Button, Layout, Tooltip } from "antd";
import { startAuthentication } from "@simplewebauthn/browser";
import { UiText as Text } from "./components/UiText";
import type { ThemeMode } from "./theme";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MenuOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  cancelPublicRouteBootstrapProof,
  cancelPublicRouteCutoverIntent,
  controlJob,
  discardPublicRouteCandidate,
  fetchConnectivityProviders,
  fetchPublicRouteBootstrapProof,
  fetchPublicRouteCandidate,
  fetchPublicRouteCutoverIntent,
  fetchPublicRouteVerification,
  fetchGptConfig,
  fetchHealth,
  fetchIntegrationStatus,
  fetchOperatorSession,
  fetchOperatorStatus,
  fetchPasskeyAuthenticationOptions,
  fetchJob,
  fetchJobArtifactContent,
  fetchJobArtifacts,
  fetchJobs,
  fetchSetupStatus,
  loginOperator,
  logoutOperator,
  preparePublicRouteBootstrapProof,
  preparePublicRouteCutoverIntent,
  redeemLocalLoginGrant,
  stagePublicRouteCandidate,
  setOperatorCsrfToken,
  verifyPublicRouteBootstrapProof,
  verifyPublicRouteCandidate,
  verifyPasskeyAuthentication,
  verifyOperatorTotpLogin,
  terminateAllJobs,
  type OperatorSecondFactorChallengeResponse,
  type OperatorSessionResponse
} from "./api";
import { AppSidebar } from "./components/AppSidebar";
import { AppUtilityPopover } from "./components/AppUtilityPopover";
import { DashboardView, type DashboardJobsDataState } from "./components/DashboardView";
import { SetupWizardView } from "./components/SetupWizardView";
import { StateNotice } from "./components/StateNotice";
import { OperatorLoginView } from "./components/OperatorLoginView";
import { OperatorSecondFactorView } from "./components/OperatorSecondFactorView";
import { OperatorPasskeyManager } from "./components/OperatorPasskeyManager";
import { OperatorSetupRequiredView } from "./components/OperatorSetupRequiredView";
import type {
  ArtifactPreviewState,
  ConnectivityProviderPublicSnapshot,
  PublicRouteBootstrapProofSnapshot,
  PublicRouteCandidateSnapshot,
  PublicRouteCandidateSource,
  PublicRouteCutoverIntentSnapshot,
  PublicRouteVerificationSnapshot,
  ContinuitySectionKey,
  GptConfigModel,
  HealthModel,
  IntegrationStatusResponse,
  JobSummary,
  SetupStatusResponse
} from "./types";
import { countJobs, summarizeJob } from "./utils";
import {
  getStoredLocale,
  getUiCopy,
  persistLocale,
  type LocaleCode
} from "./i18n";
import { getResourceCenterCopy } from "./i18n/resources";
import { getIntegrationsCopy } from "./i18n/integrations";
import { getPublicAccessCopy } from "./i18n/public-access";
import type { ApiProblem } from "./types";
import { consolePath, stripConsoleBasePath } from "./console-path";
import {
  resolveBrowserNavigationTarget,
  selectedBrowserNavigationKey,
  type AppViewKey
} from "./navigation";

type OperatorAuthState = "loading" | "setup-required" | "login-required" | "authenticated";

function readSecureLoginGate(): string | null {
  if (typeof window === "undefined") return null;
  const gate = new URLSearchParams(window.location.search).get("gate")?.trim() ?? "";
  return /^cc_login_gate_[A-Za-z0-9_-]{43}$/.test(gate) ? gate : null;
}

interface OAuthLoginBootstrap {
  requestId: string;
  uiLocales: "zh-CN" | "en-US" | null;
}

function readOAuthLoginBootstrap(): OAuthLoginBootstrap | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("oauth_request_id")?.trim() ?? "";
  if (!/^oauth_request_[0-9a-f-]{36}$/i.test(requestId)) return null;
  const locale = params.get("ui_locales");
  return {
    requestId,
    uiLocales: locale === "zh-CN" || locale === "en-US" ? locale : null
  };
}

function continueOAuthApprovalIfRequested(): boolean {
  const bootstrap = readOAuthLoginBootstrap();
  if (!bootstrap || typeof window === "undefined") return false;
  const params = new URLSearchParams({ request_id: bootstrap.requestId });
  if (bootstrap.uiLocales) params.set("ui_locales", bootstrap.uiLocales);
  window.location.assign(`/oauth/authorize?${params.toString()}`);
  return true;
}

const LOCAL_LOGIN_CONTINUATION_TARGETS = {
  projects: consolePath("projects"),
  work: consolePath("continuity/tasks"),
  runtime: consolePath("runtime"),
  resources: consolePath("resources"),
  devices: consolePath("devices"),
  publicAccess: consolePath("public-access"),
  integrations: consolePath("integrations")
} as const;

type LocalLoginContinuationTarget = keyof typeof LOCAL_LOGIN_CONTINUATION_TARGETS;

function localLoginContinuationPath(): string | null {
  if (
    typeof window === "undefined" ||
    window.location.pathname !== consolePath("local-login")
  ) {
    return null;
  }
  const target = new URLSearchParams(window.location.search).get("target");
  if (!target || !(target in LOCAL_LOGIN_CONTINUATION_TARGETS)) return null;
  return LOCAL_LOGIN_CONTINUATION_TARGETS[target as LocalLoginContinuationTarget];
}

function finishOperatorAuthentication(): void {
  if (continueOAuthApprovalIfRequested()) return;
  if (
    typeof window !== "undefined" &&
    [consolePath("login"), consolePath("local-login")].includes(window.location.pathname)
  ) {
    window.history.replaceState(
      null,
      "",
      localLoginContinuationPath() ?? `${consolePath()}/`
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

function readAndClearLocalLoginGrant(): string | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const grant = params.get("local-login");
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`
  );
  if (!grant || !/^cc_local_login_[A-Za-z0-9_-]{43}$/.test(grant)) return null;
  return grant;
}

const JobsView = lazy(() =>
  import("./components/JobsView").then((module) => ({ default: module.JobsView }))
);
const IntegrationsView = lazy(() =>
  import("./components/IntegrationsView").then((module) => ({ default: module.IntegrationsView }))
);
const PublicAccessView = lazy(() =>
  import("./components/PublicAccessView").then((module) => ({ default: module.PublicAccessView }))
);
const DevicesView = lazy(() =>
  import("./components/DevicesView").then((module) => ({ default: module.DevicesView }))
);
const ProjectCenterView = lazy(() =>
  import("./components/projects/ProjectCenterView").then((module) => ({
    default: module.ProjectCenterView
  }))
);
const ProjectCockpitView = lazy(() =>
  import("./components/projects/ProjectCockpitView").then((module) => ({
    default: module.ProjectCockpitView
  }))
);
const ContinuityWorkbenchView = lazy(() =>
  import("./components/continuity/ContinuityWorkbenchView").then((module) => ({
    default: module.ContinuityWorkbenchView
  }))
);
const ResourceCenterView = lazy(() =>
  import("./components/resources/ResourceCenterView").then((module) => ({
    default: module.ResourceCenterView
  }))
);
const RuntimeView = lazy(() =>
  import("./components/RuntimeView").then((module) => ({ default: module.RuntimeView }))
);

type ViewKey = AppViewKey;

interface AppProps {
  themeMode: ThemeMode;
  onThemeModeChange: (themeMode: ThemeMode) => void;
}

const VIEW_PATHS: Record<ViewKey, string> = {
  dashboard: consolePath(),
  projects: consolePath("projects"),
  continuity: consolePath("continuity"),
  runtime: consolePath("runtime"),
  resources: consolePath("resources"),
  devices: consolePath("devices"),
  jobs: consolePath("jobs"),
  publicAccess: consolePath("public-access"),
  integrations: consolePath("integrations")
};

const CONTINUITY_SECTIONS = new Set<ContinuitySectionKey>([
  "documents",
  "tasks",
  "sessions",
  "recovery",
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
  publicBaseUrl: null,
  build: {
    version: "unknown",
    buildId: null,
    revision: null,
    builtAt: null
  }
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

interface ParsedRoute {
  view: ViewKey;
  jobId: string | null;
  continuitySection: ContinuitySectionKey;
  projectId: string | null;
}

function baseRoute(view: ViewKey = "dashboard"): ParsedRoute {
  return {
    view,
    jobId: null,
    continuitySection: "tasks",
    projectId: null
  };
}

function parseRoute(): ParsedRoute {
  if (typeof window === "undefined") return baseRoute();

  const route = stripConsoleBasePath(window.location.pathname);
  if (route === null) return baseRoute();

  if (route === "projects" || route.startsWith("projects/")) {
    const segments = route.split("/").filter(Boolean);
    const projectId = segments[1] ? decodeURIComponent(segments[1]) : null;
    if (projectId && segments.length > 2) {
      window.history.replaceState(
        null,
        "",
        `${VIEW_PATHS.projects}/${encodeURIComponent(projectId)}`
      );
    }
    return { ...baseRoute("projects"), projectId };
  }

  if (route === "jobs" || route.startsWith("jobs/")) {
    const jobId = route.startsWith("jobs/")
      ? decodeURIComponent(route.slice("jobs/".length))
      : null;
    return { ...baseRoute("jobs"), jobId: jobId || null };
  }

  if (route === "continuity" || route.startsWith("continuity/")) {
    const candidate = route.startsWith("continuity/")
      ? decodeURIComponent(route.slice("continuity/".length))
      : "tasks";
    if (candidate === "projects") {
      window.history.replaceState(null, "", VIEW_PATHS.projects);
      return baseRoute("projects");
    }
    const continuitySection = CONTINUITY_SECTIONS.has(candidate as ContinuitySectionKey)
      ? (candidate as ContinuitySectionKey)
      : "tasks";
    return { ...baseRoute("continuity"), continuitySection };
  }

  if (route === "runtime") return baseRoute("runtime");
  if (route === "resources") return baseRoute("resources");
  if (route === "devices") return baseRoute("devices");
  if (route === "public-access") return baseRoute("publicAccess");
  if (route === "integrations") return baseRoute("integrations");
  if (route === "gpt-helper") {
    window.history.replaceState(null, "", VIEW_PATHS.integrations);
    return baseRoute("integrations");
  }
  return baseRoute();
}

export default function App({ themeMode, onThemeModeChange }: AppProps) {
  const [locale, setLocale] = useState<LocaleCode>(getStoredLocale);
  const [activeView, setActiveView] = useState<ViewKey>(() => parseRoute().view);
  const [activeContinuitySection, setActiveContinuitySection] =
    useState<ContinuitySectionKey>(() => parseRoute().continuitySection);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => parseRoute().projectId
  );
  const [operatorAuthState, setOperatorAuthState] = useState<OperatorAuthState>("loading");
  const [operatorSession, setOperatorSession] = useState<OperatorSessionResponse | null>(null);
  const [operatorAuthError, setOperatorAuthError] = useState<string | null>(null);
  const [operatorDesktopSetupAvailable, setOperatorDesktopSetupAvailable] = useState(false);
  const [operatorSetupChecking, setOperatorSetupChecking] = useState(false);
  const [operatorSetupFeedback, setOperatorSetupFeedback] = useState<string | null>(null);
  const [operatorSetupFeedbackError, setOperatorSetupFeedbackError] = useState(false);
  const [operatorLoginLoading, setOperatorLoginLoading] = useState(false);
  const [operatorSecondFactor, setOperatorSecondFactor] =
    useState<OperatorSecondFactorChallengeResponse | null>(null);
  const [operatorPasskeyLoading, setOperatorPasskeyLoading] = useState(false);
  const [operatorSecurityOpen, setOperatorSecurityOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [health, setHealth] = useState<HealthModel>(INITIAL_HEALTH);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [gptConfig, setGptConfig] = useState<GptConfigModel | null>(null);
  const [gptConfigError, setGptConfigError] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatusResponse | null>(null);
  const [integrationStatusError, setIntegrationStatusError] = useState<string | null>(null);
  const [connectivityProviderStatus, setConnectivityProviderStatus] =
    useState<ConnectivityProviderPublicSnapshot | null>(null);
  const [connectivityProviderStatusError, setConnectivityProviderStatusError] = useState<string | null>(null);
  const [publicRouteCandidateStatus, setPublicRouteCandidateStatus] =
    useState<PublicRouteCandidateSnapshot | null>(null);
  const [publicRouteCandidateError, setPublicRouteCandidateError] = useState<string | null>(null);
  const [publicRouteCandidateMutating, setPublicRouteCandidateMutating] = useState(false);
  const [publicRouteVerificationStatus, setPublicRouteVerificationStatus] =
    useState<PublicRouteVerificationSnapshot | null>(null);
  const [publicRouteVerificationError, setPublicRouteVerificationError] = useState<string | null>(null);
  const [publicRouteVerifying, setPublicRouteVerifying] = useState(false);
  const [publicRouteCutoverIntentStatus, setPublicRouteCutoverIntentStatus] =
    useState<PublicRouteCutoverIntentSnapshot | null>(null);
  const [publicRouteCutoverIntentError, setPublicRouteCutoverIntentError] = useState<string | null>(null);
  const [publicRouteCutoverIntentMutating, setPublicRouteCutoverIntentMutating] = useState(false);
  const [publicRouteBootstrapProofStatus, setPublicRouteBootstrapProofStatus] =
    useState<PublicRouteBootstrapProofSnapshot | null>(null);
  const [publicRouteBootstrapProofError, setPublicRouteBootstrapProofError] = useState<string | null>(null);
  const [publicRouteBootstrapProofMutating, setPublicRouteBootstrapProofMutating] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsDataState, setJobsDataState] = useState<DashboardJobsDataState>("loading");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => parseRoute().jobId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewState | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [controlLoading, setControlLoading] = useState(false);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const jobControlKeys = useRef(new Map<string, string>());
  const copy = getUiCopy(locale);
  const resourceCopy = getResourceCenterCopy(locale);
  const integrationsCopy = getIntegrationsCopy(locale);
  const publicAccessCopy = getPublicAccessCopy(locale);
  // Transitional non-secret marker for legacy view props. api.ts never transmits it.
  const token = operatorSession ? "operator-session" : null;

  useEffect(() => {
    void bootstrapOperatorAuth();
  }, []);

  useEffect(() => {
    if (operatorAuthState === "authenticated") {
      void loadHealth();
    }
  }, [operatorAuthState]);

  useEffect(() => {
    function onPopState() {
      const route = parseRoute();
      setActiveView(route.view);
      setSelectedJobId(route.jobId);
      setActiveContinuitySection(route.continuitySection);
      setSelectedProjectId(route.projectId);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (operatorAuthState === "authenticated" && !healthLoading) {
      void loadJobs(token, health.authRequired, activeView === "jobs");
    }
  }, [operatorAuthState, healthLoading, token, locale, health.authRequired]);

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
      if (apiProblem.status === 401 && operatorAuthState === "authenticated") {
        setOperatorSession(null);
        setOperatorCsrfToken(null);
        setOperatorAuthState("login-required");
        setOperatorAuthError(copy.operatorAuth.sessionExpired);
      }
      return typeof apiProblem.message === "string"
        ? apiProblem.message
        : String(apiProblem.message ?? error);
    }
    return String(error);
  }

  async function bootstrapOperatorAuth(manualCheck = false) {
    setOperatorAuthError(null);
    if (manualCheck) {
      setOperatorSetupChecking(true);
      setOperatorSetupFeedback(null);
      setOperatorSetupFeedbackError(false);
    }
    const localLoginGrant = readAndClearLocalLoginGrant();
    const loginGate = readSecureLoginGate();
    const oauthBootstrap = readOAuthLoginBootstrap();
    try {
      if (localLoginGrant) {
        try {
          const session = await redeemLocalLoginGrant(localLoginGrant);
          setOperatorSession(session);
          finishOperatorAuthentication();
          setOperatorAuthState("authenticated");
          return;
        } catch {
          setOperatorAuthError(copy.operatorAuth.localUnlockFailed);
        }
      }
      const status = await fetchOperatorStatus(loginGate, oauthBootstrap?.requestId);
      setOperatorDesktopSetupAvailable(status.desktopSetupAvailable);
      if (!status.configured) {
        setOperatorSession(null);
        setOperatorCsrfToken(null);
        setOperatorAuthState("setup-required");
        if (manualCheck) {
          setOperatorSetupFeedback(copy.operatorAuth.setupStillRequired);
          setOperatorSetupFeedbackError(false);
        }
        return;
      }
      try {
        const session = await fetchOperatorSession();
        setOperatorSession(session);
        finishOperatorAuthentication();
        setOperatorAuthState("authenticated");
      } catch (error) {
        const problem = error as ApiProblem;
        setOperatorSession(null);
        setOperatorCsrfToken(null);
        setOperatorAuthState("login-required");
        if (problem?.status !== 401 && !localLoginGrant) {
          setOperatorAuthError(getErrorMessage(error));
        }
      }
    } catch (error) {
      setOperatorSession(null);
      setOperatorCsrfToken(null);
      if (manualCheck) {
        setOperatorAuthState("setup-required");
        setOperatorSetupFeedback(copy.operatorAuth.setupCheckFailed);
        setOperatorSetupFeedbackError(true);
      } else {
        setOperatorDesktopSetupAvailable(false);
        setOperatorAuthState("login-required");
        setOperatorAuthError(getErrorMessage(error));
      }
    } finally {
      if (manualCheck) {
        setOperatorSetupChecking(false);
      }
    }
  }

  async function signInWithPasskey() {
    setOperatorPasskeyLoading(true);
    setOperatorSecondFactor(null);
    setOperatorAuthError(null);
    try {
      const loginGate = readSecureLoginGate();
      const oauthBootstrap = readOAuthLoginBootstrap();
      const options = await fetchPasskeyAuthenticationOptions(
        loginGate,
        oauthBootstrap?.requestId
      );
      const response = await startAuthentication({ optionsJSON: options });
      const session = await verifyPasskeyAuthentication(
        {
          challenge: options.challenge,
          response
        },
        loginGate,
        oauthBootstrap?.requestId
      );
      setOperatorSession(session);
      finishOperatorAuthentication();
      setOperatorAuthState("authenticated");
    } catch (error) {
      const problem = error as ApiProblem;
      setOperatorAuthError(
        problem?.code === "PASSKEY_NOT_CONFIGURED"
          ? copy.operatorAuth.passkeyNotConfigured
          : getErrorMessage(error)
      );
    } finally {
      setOperatorPasskeyLoading(false);
    }
  }

  async function signInOperator(input: { username: string; password: string }) {
    setOperatorLoginLoading(true);
    setOperatorAuthError(null);
    try {
      const loginGate = readSecureLoginGate();
      const oauthBootstrap = readOAuthLoginBootstrap();
      const result = await loginOperator(input, loginGate, oauthBootstrap?.requestId);
      if ("requiresSecondFactor" in result) {
        setOperatorSession(null);
        setOperatorSecondFactor(result);
        return;
      }
      setOperatorSecondFactor(null);
      setOperatorSession(result);
      finishOperatorAuthentication();
      setOperatorAuthState("authenticated");
    } catch (error) {
      setOperatorAuthError(getErrorMessage(error));
    } finally {
      setOperatorLoginLoading(false);
    }
  }

  async function verifyOperatorSecondFactor(verification: string) {
    const challenge = operatorSecondFactor;
    if (!challenge) return;
    setOperatorLoginLoading(true);
    setOperatorAuthError(null);
    try {
      const loginGate = readSecureLoginGate();
      const oauthBootstrap = readOAuthLoginBootstrap();
      const session = await verifyOperatorTotpLogin(
        {
          challenge: challenge.challenge,
          verification
        },
        loginGate,
        oauthBootstrap?.requestId
      );
      setOperatorSecondFactor(null);
      setOperatorSession(session);
      finishOperatorAuthentication();
      setOperatorAuthState("authenticated");
    } catch (error) {
      setOperatorAuthError(getErrorMessage(error));
    } finally {
      setOperatorLoginLoading(false);
    }
  }

  async function signOutOperator() {
    try {
      const logout = await logoutOperator();
      setOperatorSession(null);
      setOperatorSecondFactor(null);
      setOperatorAuthState("login-required");
      setHealth(INITIAL_HEALTH);
      setJobs([]);
      setJobsDataState("protected");
      setGptConfig(null);
      setIntegrationStatus(null);
      setIntegrationStatusError(null);
      setConnectivityProviderStatus(null);
      setConnectivityProviderStatusError(null);
      setPublicRouteCandidateStatus(null);
      setPublicRouteCandidateError(null);
      setPublicRouteCandidateMutating(false);
      setPublicRouteVerificationStatus(null);
      setPublicRouteVerificationError(null);
      setPublicRouteVerifying(false);
      setPublicRouteCutoverIntentStatus(null);
      setPublicRouteCutoverIntentError(null);
      setPublicRouteCutoverIntentMutating(false);
      setPublicRouteBootstrapProofStatus(null);
      setPublicRouteBootstrapProofError(null);
      setPublicRouteBootstrapProofMutating(false);
      setSetupStatus(null);
      if (typeof window !== "undefined") {
        window.location.assign(logout.loginPath);
      }
    } catch (error) {
      setOperatorAuthError(getErrorMessage(error));
    }
  }

  async function loadCompatibilityConfig(nextLocale: LocaleCode) {
    try {
      const gptConfigResponse = await fetchGptConfig(nextLocale, token);
      setGptConfig(gptConfigResponse.config);
      setGptConfigError(null);
    } catch (error) {
      setGptConfig(null);
      setGptConfigError(getErrorMessage(error));
    }
  }

  async function loadHealth() {
    setHealthLoading(true);
    setHealthError(null);

    try {
      const healthResponse = await fetchHealth();
      setHealth({
        ...healthResponse,
        build: healthResponse.build ?? INITIAL_HEALTH.build
      });
      try {
        const setupResponse = await fetchSetupStatus(token);
        setSetupStatus(setupResponse);
      } catch {
        setSetupStatus(null);
      }
      try {
        const integrationResponse = await fetchIntegrationStatus(token);
        setIntegrationStatus(integrationResponse);
        setIntegrationStatusError(null);
      } catch (error) {
        setIntegrationStatus(null);
        setIntegrationStatusError(getErrorMessage(error));
      }
      try {
        const providerResponse = await fetchConnectivityProviders(token);
        setConnectivityProviderStatus(providerResponse);
        setConnectivityProviderStatusError(null);
      } catch (error) {
        setConnectivityProviderStatus(null);
        setConnectivityProviderStatusError(getErrorMessage(error));
      }
      try {
        const routeResponse = await fetchPublicRouteCandidate(token);
        setPublicRouteCandidateStatus(routeResponse);
        setPublicRouteCandidateError(null);
      } catch (error) {
        setPublicRouteCandidateStatus(null);
        setPublicRouteCandidateError(getErrorMessage(error));
      }
      try {
        const verificationResponse = await fetchPublicRouteVerification(token);
        setPublicRouteVerificationStatus(verificationResponse);
        setPublicRouteVerificationError(null);
      } catch (error) {
        setPublicRouteVerificationStatus(null);
        setPublicRouteVerificationError(getErrorMessage(error));
      }
      try {
        const cutoverIntentResponse = await fetchPublicRouteCutoverIntent(token);
        setPublicRouteCutoverIntentStatus(cutoverIntentResponse);
        setPublicRouteCutoverIntentError(null);
      } catch (error) {
        setPublicRouteCutoverIntentStatus(null);
        setPublicRouteCutoverIntentError(getErrorMessage(error));
      }
      try {
        const bootstrapProofResponse = await fetchPublicRouteBootstrapProof(token);
        setPublicRouteBootstrapProofStatus(bootstrapProofResponse);
        setPublicRouteBootstrapProofError(null);
      } catch (error) {
        setPublicRouteBootstrapProofStatus(null);
        setPublicRouteBootstrapProofError(getErrorMessage(error));
      }
      await loadCompatibilityConfig(locale);
    } catch (error) {
      setHealthError(getErrorMessage(error));
    } finally {
      setHealthLoading(false);
    }
  }

  async function stageCandidatePublicRoute(
    origin: string,
    source: PublicRouteCandidateSource
  ) {
    if (publicRouteCandidateMutating) return;
    setPublicRouteCandidateMutating(true);
    setPublicRouteCandidateError(null);
    try {
      const response = await stagePublicRouteCandidate({ origin, source }, token);
      setPublicRouteCandidateStatus(response);
      setPublicRouteVerificationStatus(null);
      setPublicRouteVerificationError(null);
      setPublicRouteCutoverIntentStatus(null);
      setPublicRouteCutoverIntentError(null);
      setPublicRouteBootstrapProofStatus(null);
      setPublicRouteBootstrapProofError(null);
    } catch (error) {
      setPublicRouteCandidateError(getErrorMessage(error));
    } finally {
      setPublicRouteCandidateMutating(false);
    }
  }

  async function discardCandidatePublicRoute() {
    if (publicRouteCandidateMutating) return;
    setPublicRouteCandidateMutating(true);
    setPublicRouteCandidateError(null);
    try {
      const response = await discardPublicRouteCandidate(token);
      setPublicRouteCandidateStatus(response);
      setPublicRouteVerificationStatus(null);
      setPublicRouteVerificationError(null);
      setPublicRouteCutoverIntentStatus(null);
      setPublicRouteCutoverIntentError(null);
      setPublicRouteBootstrapProofStatus(null);
      setPublicRouteBootstrapProofError(null);
    } catch (error) {
      setPublicRouteCandidateError(getErrorMessage(error));
    } finally {
      setPublicRouteCandidateMutating(false);
    }
  }

  async function verifyCandidatePublicRoute(candidateId: string) {
    if (publicRouteVerifying || publicRouteCandidateMutating) return;
    setPublicRouteVerifying(true);
    setPublicRouteVerificationError(null);
    try {
      const response = await verifyPublicRouteCandidate(candidateId, token);
      setPublicRouteVerificationStatus(response);
      setPublicRouteCutoverIntentStatus(null);
      setPublicRouteCutoverIntentError(null);
    } catch (error) {
      setPublicRouteVerificationError(getErrorMessage(error));
    } finally {
      setPublicRouteVerifying(false);
    }
  }

  async function prepareCandidateCutoverIntent(candidateId: string, verificationId: string) {
    if (publicRouteCutoverIntentMutating || publicRouteVerifying || publicRouteCandidateMutating) return;
    setPublicRouteCutoverIntentMutating(true);
    setPublicRouteCutoverIntentError(null);
    try {
      const response = await preparePublicRouteCutoverIntent({ candidateId, verificationId }, token);
      setPublicRouteCutoverIntentStatus(response);
    } catch (error) {
      setPublicRouteCutoverIntentError(getErrorMessage(error));
    } finally {
      setPublicRouteCutoverIntentMutating(false);
    }
  }

  async function cancelCandidateCutoverIntent() {
    if (publicRouteCutoverIntentMutating) return;
    setPublicRouteCutoverIntentMutating(true);
    setPublicRouteCutoverIntentError(null);
    try {
      const response = await cancelPublicRouteCutoverIntent(token);
      setPublicRouteCutoverIntentStatus(response);
    } catch (error) {
      setPublicRouteCutoverIntentError(getErrorMessage(error));
    } finally {
      setPublicRouteCutoverIntentMutating(false);
    }
  }

  async function prepareBootstrapProof(candidateId: string) {
    if (publicRouteBootstrapProofMutating || publicRouteCandidateMutating) return;
    setPublicRouteBootstrapProofMutating(true);
    setPublicRouteBootstrapProofError(null);
    try {
      const response = await preparePublicRouteBootstrapProof(candidateId, token);
      setPublicRouteBootstrapProofStatus(response);
    } catch (error) {
      setPublicRouteBootstrapProofError(getErrorMessage(error));
    } finally {
      setPublicRouteBootstrapProofMutating(false);
    }
  }

  async function verifyBootstrapProof(candidateId: string, proofId: string) {
    if (publicRouteBootstrapProofMutating || publicRouteCandidateMutating) return;
    setPublicRouteBootstrapProofMutating(true);
    setPublicRouteBootstrapProofError(null);
    try {
      const response = await verifyPublicRouteBootstrapProof({ candidateId, proofId }, token);
      setPublicRouteBootstrapProofStatus(response);
    } catch (error) {
      setPublicRouteBootstrapProofError(getErrorMessage(error));
    } finally {
      setPublicRouteBootstrapProofMutating(false);
    }
  }

  async function cancelBootstrapProof() {
    if (publicRouteBootstrapProofMutating) return;
    setPublicRouteBootstrapProofMutating(true);
    setPublicRouteBootstrapProofError(null);
    try {
      const response = await cancelPublicRouteBootstrapProof(token);
      setPublicRouteBootstrapProofStatus(response);
    } catch (error) {
      setPublicRouteBootstrapProofError(getErrorMessage(error));
    } finally {
      setPublicRouteBootstrapProofMutating(false);
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
      setJobsDataState("protected");
      setSelectedJobId(null);
      setSelectedArtifactKey(null);
      setArtifactPreview(null);
      setArtifactError(null);
      return;
    }

    setJobsLoading(true);
    setJobsError(null);
    setJobsDataState("loading");

    try {
      const response = await fetchJobs(currentToken, { limit: 20, includeResult: false });
      const summarized = response.jobs.map((job) => summarizeJob(job, locale));
      setJobs(summarized);
      if (summarized.length > 0) {
        setJobsDataState("ready");
      } else {
        setJobsDataState("empty");
      }

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
      setJobsDataState("unavailable");
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

  function updateLocale(nextLocale: LocaleCode) {
    persistLocale(nextLocale);
    setLocale(nextLocale);
    if (operatorAuthState === "authenticated") {
      void loadCompatibilityConfig(nextLocale);
    }
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

    if (nextView === "jobs") setSelectedJobId(nextJobId ?? null);
    if (nextView === "continuity") setActiveContinuitySection(nextContinuitySection);
    if (nextView === "projects") {
      setSelectedProjectId(null);
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

  function navigateProject(projectId: string) {
    setActiveView("projects");
    setSelectedProjectId(projectId);
    if (typeof window !== "undefined") {
      const nextPath = `${VIEW_PATHS.projects}/${encodeURIComponent(projectId)}`;
      if (window.location.pathname !== nextPath) {
        window.history.pushState(null, "", nextPath);
      }
    }
  }

  function navigateContinuitySection(section: ContinuitySectionKey) {
    if (section === "projects") {
      navigateView("projects");
      return;
    }
    navigateView("continuity", null, section);
  }

  async function controlSelectedJob(action: "pause" | "resume" | "terminate") {
    if (!selectedJobId) return;
    const targetJob = jobs.find((job) => job.id === selectedJobId);
    if (!targetJob?.process) return;

    const targetJobId = targetJob.id;
    const expectedRevision = targetJob.process.revision;
    const operationKey = `${targetJobId}:${action}:${expectedRevision}`;
    let idempotencyKey = jobControlKeys.current.get(operationKey);
    if (!idempotencyKey) {
      idempotencyKey = `job.process.control.web:${crypto.randomUUID()}`;
      jobControlKeys.current.set(operationKey, idempotencyKey);
    }

    setControlLoading(true);
    setControlMessage(null);
    setJobsError(null);

    try {
      const response = await controlJob(
        targetJobId,
        { action, expectedRevision, idempotencyKey },
        token
      );
      jobControlKeys.current.delete(operationKey);
      setControlMessage(response.message);
      await loadJobDetail(targetJobId, token);
      await loadJobs(token, health.authRequired, false);
    } catch (error) {
      const explicitCode =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (explicitCode) jobControlKeys.current.delete(operationKey);
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
  const headerProductVersion = gptConfig?.productVersion ?? __CHATCOCKPIT_VERSION__.productVersion;
  const headerSchemaVersion = gptConfig?.schemaVersion ?? __CHATCOCKPIT_VERSION__.schemaVersion;
  const headerBuildVersion = gptConfig?.buildVersion ?? __CHATCOCKPIT_VERSION__.buildVersion;
  const headerVersionText = headerSchemaVersion
    ? `${headerProductVersion} (${headerSchemaVersion})`
    : headerProductVersion;
  const activeViewTitle = {
    dashboard: copy.header.dashboard,
    projects: copy.header.projects,
    continuity: copy.header.continuity,
    runtime: copy.header.runtime,
    resources: copy.header.resources,
    devices: copy.header.devices,
    jobs: copy.header.jobs,
    publicAccess: copy.header.publicAccess,
    integrations: copy.header.integrations
  } satisfies Record<ViewKey, string>;

  if (operatorAuthState === "loading") {
    return (
      <div className="app-shell">
        <StateNotice
          kind="loading"
          title={copy.operatorAuth.loadingTitle}
          description={copy.operatorAuth.loadingDescription}
          retryLabel={copy.common.retry}
        />
      </div>
    );
  }

  if (operatorAuthState === "setup-required") {
    return (
      <div className="app-shell">
        <OperatorSetupRequiredView
          locale={locale}
          checking={operatorSetupChecking}
          desktopSetupAvailable={operatorDesktopSetupAvailable}
          feedback={operatorSetupFeedback}
          feedbackError={operatorSetupFeedbackError}
          onRefresh={() => void bootstrapOperatorAuth(true)}
        />
      </div>
    );
  }

  if (operatorAuthState === "login-required") {
    return (
      <div className="app-shell">
        {operatorSecondFactor ? (
          <OperatorSecondFactorView
            locale={locale}
            loading={operatorLoginLoading}
            error={operatorAuthError}
            onBack={() => {
              setOperatorSecondFactor(null);
              setOperatorAuthError(null);
            }}
            onSubmit={verifyOperatorSecondFactor}
          />
        ) : (
          <OperatorLoginView
            locale={locale}
            loading={operatorLoginLoading}
            passkeyLoading={operatorPasskeyLoading}
            error={operatorAuthError}
            onPasskey={signInWithPasskey}
            onSubmit={signInOperator}
          />
        )}
      </div>
    );
  }

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
    <Layout hasSider className="app-shell">
      <AppSidebar
        activeNavigationKey={selectedBrowserNavigationKey(activeView, activeContinuitySection)}
        mobileOpen={mobileNavigationOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
        onNavigate={(key) => {
          const target = resolveBrowserNavigationTarget(key);
          navigateView(target.view, null, target.continuitySection);
        }}
        labels={{
          title: copy.header.title,
          dashboard: copy.header.dashboard,
          projects: copy.header.projects,
          workNavigation: copy.header.workNavigation,
          workCoordination: copy.header.workCoordination,
          jobs: copy.header.jobs,
          approvals: copy.header.approvals,
          executionNavigation: copy.header.executionNavigation,
          runtime: copy.header.runtime,
          resources: copy.header.resources,
          devices: copy.header.devices,
          connectionsNavigation: copy.header.connectionsNavigation,
          publicAccess: copy.header.publicAccess,
          integrations: copy.header.integrations,
          collapseNavigation: copy.header.collapseNavigation,
          expandNavigation: copy.header.expandNavigation,
          closeNavigation: copy.header.closeNavigation
        }}
      />
      <Layout className="app-main-shell">
        <Layout.Header className="app-header">
          <div className="app-header__inner">
            <div className="app-header__top">
              <div className="app-page-heading">
                <Button
                  type="text"
                  className="app-sidebar-mobile-trigger"
                  aria-label={copy.header.openNavigation}
                  icon={<MenuOutlined />}
                  onClick={() => setMobileNavigationOpen(true)}
                />
                <div className="app-header__copy">
                  <Text as="div" className="app-header__title">
                    {activeViewTitle[activeView]}
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
              <div className="app-toolbar app-toolbar--compact">
                <div className="app-toolbar__group app-toolbar__group--action">
                  <Tooltip title={copy.header.refreshTooltip}>
                    <Button
                      aria-label={copy.header.refresh}
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        void loadHealth();
                        void loadJobs(token, health.authRequired, activeView === "jobs");
                      }}
                      loading={jobsLoading || healthLoading}
                    />
                  </Tooltip>
                  <AppUtilityPopover
                    locale={locale}
                    themeMode={themeMode}
                    username={operatorSession?.username ?? "owner"}
                    onLocaleChange={updateLocale}
                    onThemeModeChange={onThemeModeChange}
                    onOpenSecurity={() => setOperatorSecurityOpen(true)}
                    onSignOut={() => void signOutOperator()}
                  />
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
                onOpenIntegrations={() => navigateView("integrations")}
                onRefresh={() => void loadHealth()}
              />
            ) : null}
            <DashboardView
              locale={locale}
              health={health}
              integrationStatus={integrationStatus ?? undefined}
              repoGovernance={gptConfig?.repoGovernance}
              counts={counts}
              recentJobs={jobs.slice(0, 5)}
              jobsDataState={jobsDataState}
              onSelectJob={(jobId) => {
                navigateView("jobs", jobId);
                void loadJobDetail(jobId, token);
              }}
              onOpenIntegrations={() => navigateView("integrations")}
              onRefresh={() => {
                void loadHealth();
                void loadJobs(token, health.authRequired, false);
              }}
            />
          </div>
        ) : null}

        {activeView === "projects" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.header.projects}
                description={copy.notices.loadingConsoleDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            {selectedProjectId ? (
              <ProjectCockpitView
                locale={locale}
                token={token}
                projectId={selectedProjectId}
                onBack={() => navigateView("projects")}
              />
            ) : (
              <ProjectCenterView
                locale={locale}
                token={token}
                authRequired={health.authRequired}
                onOpenProject={(projectId) => navigateProject(projectId)}
              />
            )}
          </Suspense>
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
              onOpenProjects={() => navigateView("projects")}
            />
          </Suspense>
        ) : null}

        {activeView === "runtime" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.header.runtime}
                description={copy.notices.loadingConsoleDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <RuntimeView locale={locale} health={health} />
          </Suspense>
        ) : null}

        {activeView === "resources" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={resourceCopy.loadingTitle}
                description={resourceCopy.loadingDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <ResourceCenterView
              locale={locale}
              token={token}
              authRequired={health.authRequired}
            />
          </Suspense>
        ) : null}

        {activeView === "devices" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={copy.header.devices}
                description={copy.notices.loadingConsoleDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            <DevicesView locale={locale} />
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

        {activeView === "publicAccess" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={publicAccessCopy.loadingTitle}
                description={publicAccessCopy.loadingDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            {integrationStatus ? (
              <PublicAccessView
                locale={locale}
                status={integrationStatus}
                exposed={health.exposed}
                providerStatus={connectivityProviderStatus}
                providerStatusError={connectivityProviderStatusError}
                routeStatus={publicRouteCandidateStatus}
                routeStatusError={publicRouteCandidateError}
                routeMutating={publicRouteCandidateMutating}
                verificationStatus={publicRouteVerificationStatus}
                verificationStatusError={publicRouteVerificationError}
                routeVerifying={publicRouteVerifying}
                cutoverIntentStatus={publicRouteCutoverIntentStatus}
                cutoverIntentStatusError={publicRouteCutoverIntentError}
                cutoverIntentMutating={publicRouteCutoverIntentMutating}
                bootstrapProofStatus={publicRouteBootstrapProofStatus}
                bootstrapProofStatusError={publicRouteBootstrapProofError}
                bootstrapProofMutating={publicRouteBootstrapProofMutating}
                onStageCandidate={(origin, source) => void stageCandidatePublicRoute(origin, source)}
                onDiscardCandidate={() => void discardCandidatePublicRoute()}
                onVerifyCandidate={(candidateId) => void verifyCandidatePublicRoute(candidateId)}
                onPrepareCutoverIntent={(candidateId, verificationId) => void prepareCandidateCutoverIntent(candidateId, verificationId)}
                onCancelCutoverIntent={() => void cancelCandidateCutoverIntent()}
                onPrepareBootstrapProof={(candidateId) => void prepareBootstrapProof(candidateId)}
                onVerifyBootstrapProof={(candidateId, proofId) => void verifyBootstrapProof(candidateId, proofId)}
                onCancelBootstrapProof={() => void cancelBootstrapProof()}
                onOpenIntegrations={() => navigateView("integrations")}
              />
            ) : (
              <StateNotice
                kind="error"
                title={publicAccessCopy.requestFailed}
                description={integrationStatusError ?? copy.notices.bootstrapFailedTitle}
                retryLabel={copy.common.retry}
                onRetry={() => void loadHealth()}
              />
            )}
          </Suspense>
        ) : null}

        {activeView === "integrations" ? (
          <Suspense
            fallback={
              <ViewLoadingState
                title={integrationsCopy.loadingTitle}
                description={integrationsCopy.loadingDescription}
                retryLabel={copy.common.retry}
              />
            }
          >
            {integrationStatus ? (
              <IntegrationsView
                locale={locale}
                status={integrationStatus}
                config={gptConfig}
                configError={gptConfigError}
                onRefresh={loadHealth}
              />
            ) : (
              <StateNotice
                kind="error"
                title={integrationsCopy.requestFailed}
                description={integrationStatusError ?? copy.notices.bootstrapFailedTitle}
                retryLabel={copy.common.retry}
                onRetry={() => void loadHealth()}
              />
            )}
          </Suspense>
        ) : null}
      </Layout.Content>
        <OperatorPasskeyManager
          locale={locale}
          open={operatorSecurityOpen}
          onClose={() => setOperatorSecurityOpen(false)}
        />
      </Layout>
    </Layout>
  );
}
