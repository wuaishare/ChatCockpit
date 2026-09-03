import type { DatabaseSync } from "node:sqlite";

import { CHATCOCKPIT_TARGET_IDENTITY_MIGRATION } from "./chatcockpit-target-continuity.js";

export type R4LegacyContinuitySourceContract =
  | "v18"
  | "v19-compatible"
  | "v20-compatible"
  | "v21-compatible"
  | "v22-compatible"
  | "invalid";

export interface R4LegacyContinuitySourceInspection {
  schemaVersion: number;
  sourceContract: R4LegacyContinuitySourceContract;
  targetIdentityTablePresent: boolean;
  targetIdentityMarkerPresent: boolean;
  runtimeBindingAcceptsLegacy: boolean;
  runtimeBindingAcceptsTarget: boolean;
  runtimeResourceAcceptsLegacy: boolean;
  runtimeResourceAcceptsTarget: boolean;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?")
      .get(table)
  );
}

function tableSql(database: DatabaseSync, table: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

export function inspectR4LegacyContinuitySource(
  database: DatabaseSync
): R4LegacyContinuitySourceInspection {
  const schemaVersion = tableExists(database, "schema_migrations")
    ? Number(
        (
          database
            .prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations")
            .get() as { version: number }
        ).version
      )
    : 0;

  const targetIdentityTablePresent = tableExists(database, "product_identity_migrations");
  const targetIdentityMarkerPresent = targetIdentityTablePresent
    ? Boolean(
        database
          .prepare("SELECT 1 AS present FROM product_identity_migrations WHERE name=?")
          .get(CHATCOCKPIT_TARGET_IDENTITY_MIGRATION)
      )
    : false;

  const runtimeBindingSql = tableSql(database, "runtime_bindings");
  const runtimeResourceSql = tableSql(database, "runtime_resource_items");
  const runtimeBindingAcceptsLegacy = runtimeBindingSql.includes("'tokenpilot-runner'");
  const runtimeBindingAcceptsTarget = runtimeBindingSql.includes("'async-runner'");
  const runtimeResourceAcceptsLegacy = runtimeResourceSql.includes("'tokenpilot-local'");
  const runtimeResourceAcceptsTarget = runtimeResourceSql.includes("'control-plane-local'");

  let sourceContract: R4LegacyContinuitySourceContract = "invalid";
  if (
    schemaVersion === 18 &&
    !targetIdentityTablePresent &&
    runtimeBindingAcceptsLegacy &&
    !runtimeBindingAcceptsTarget &&
    runtimeResourceAcceptsLegacy &&
    !runtimeResourceAcceptsTarget
  ) {
    sourceContract = "v18";
  } else if (
    (schemaVersion === 19 || schemaVersion === 20 || schemaVersion === 21 || schemaVersion === 22) &&
    !targetIdentityTablePresent &&
    runtimeBindingAcceptsLegacy &&
    runtimeBindingAcceptsTarget &&
    runtimeResourceAcceptsLegacy &&
    runtimeResourceAcceptsTarget
  ) {
    if (schemaVersion === 22) {
      sourceContract = "v22-compatible";
    } else if (schemaVersion === 21) {
      sourceContract = "v21-compatible";
    } else if (schemaVersion === 20) {
      sourceContract = "v20-compatible";
    } else {
      sourceContract = "v19-compatible";
    }
  }

  return {
    schemaVersion,
    sourceContract,
    targetIdentityTablePresent,
    targetIdentityMarkerPresent,
    runtimeBindingAcceptsLegacy,
    runtimeBindingAcceptsTarget,
    runtimeResourceAcceptsLegacy,
    runtimeResourceAcceptsTarget
  };
}
