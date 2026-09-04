export type ManagedWorkspaceProcessBackend = "codex-standalone" | "builtin-direct";

export function managedWorkspaceProcessBackend(
  processId: string
): ManagedWorkspaceProcessBackend | null {
  if (processId.startsWith("chatcockpit_")) return "codex-standalone";
  if (processId.startsWith("builtin_process_")) return "builtin-direct";
  return null;
}

export function isChatDirectManagedProcessId(processId: string): boolean {
  return managedWorkspaceProcessBackend(processId) !== null;
}
