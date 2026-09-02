import type { ContinuitySectionKey } from "./types";

export type AppViewKey =
  | "dashboard"
  | "projects"
  | "continuity"
  | "runtime"
  | "resources"
  | "devices"
  | "jobs"
  | "publicAccess"
  | "integrations";

export type ProductDestinationKey =
  | "overview"
  | "projects"
  | "work"
  | "runtime"
  | "resources"
  | "devices"
  | "connections";

export const CANONICAL_PRODUCT_DESTINATIONS: ProductDestinationKey[] = [
  "overview",
  "projects",
  "work",
  "runtime",
  "resources",
  "devices",
  "connections"
];

export type BrowserNavigationLeafKey =
  | "overview"
  | "projects"
  | "workTasks"
  | "workJobs"
  | "workApprovals"
  | "runtime"
  | "resources"
  | "devices"
  | "connectionsPublicAccess"
  | "connectionsIntegrations";

export interface BrowserNavigationTarget {
  view: AppViewKey;
  continuitySection?: ContinuitySectionKey;
}

export const BROWSER_NAVIGATION_TARGETS: Record<
  BrowserNavigationLeafKey,
  BrowserNavigationTarget
> = {
  overview: { view: "dashboard" },
  projects: { view: "projects" },
  workTasks: { view: "continuity", continuitySection: "tasks" },
  workJobs: { view: "jobs" },
  workApprovals: { view: "continuity", continuitySection: "approvals" },
  runtime: { view: "runtime" },
  resources: { view: "resources" },
  devices: { view: "devices" },
  connectionsPublicAccess: { view: "publicAccess" },
  connectionsIntegrations: { view: "integrations" }
};

export function resolveBrowserNavigationTarget(
  key: BrowserNavigationLeafKey
): BrowserNavigationTarget {
  return BROWSER_NAVIGATION_TARGETS[key];
}

export function selectedBrowserNavigationKey(
  view: AppViewKey,
  continuitySection: ContinuitySectionKey
): BrowserNavigationLeafKey {
  if (view === "dashboard") return "overview";
  if (view === "projects") return "projects";
  if (view === "continuity") {
    return continuitySection === "approvals" ? "workApprovals" : "workTasks";
  }
  if (view === "jobs") return "workJobs";
  if (view === "runtime") return "runtime";
  if (view === "resources") return "resources";
  if (view === "devices") return "devices";
  if (view === "publicAccess") return "connectionsPublicAccess";
  return "connectionsIntegrations";
}
