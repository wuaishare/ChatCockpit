import { createHash } from "node:crypto";

export function stableProjectConfigId(prefix: "root", value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function rootIdForRepoId(repoId: string): string {
  return stableProjectConfigId("root", repoId);
}
