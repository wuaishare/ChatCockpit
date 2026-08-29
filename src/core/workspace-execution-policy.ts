export const WORKSPACE_EXECUTION_PROFILES = [
  "restricted",
  "development"
] as const;

export type WorkspaceExecutionProfile =
  (typeof WORKSPACE_EXECUTION_PROFILES)[number];

/**
 * ChatCockpit is a remote development product, so an explicitly registered
 * Workspace defaults to a real development execution surface rather than a
 * command-by-command allowlist. Host/Device access remains a separate policy
 * domain and is not implied by this profile.
 */
export const DEFAULT_WORKSPACE_EXECUTION_PROFILE: WorkspaceExecutionProfile =
  "development";

export function workspaceArbitraryCommandsAllowed(
  profile: WorkspaceExecutionProfile
): boolean {
  return profile === "development";
}
