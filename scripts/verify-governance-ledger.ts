import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { buildGovernanceLedger } from "../src/governance/governance-ledger.js";
import { GovernanceDatabase } from "../src/governance/database.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";
import { OperationalActivityProvenanceRepository } from "../src/governance/operational-activity-provenance-repository.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-governance-ledger-"));
const databasePath = path.join(root, "continuity.sqlite");
const database = new ContinuityDatabase({ path: databasePath });
const governanceDatabase = new GovernanceDatabase({ path: databasePath });
try {
  const repositories = buildContinuityRepositories(database);
  const externalActions = new GovernedExternalActionRepository(database);
  const activityProvenance = new OperationalActivityProvenanceRepository(database);
  const ledger = buildGovernanceLedger(repositories, externalActions, activityProvenance);

  assert.deepEqual(Object.keys(ledger).sort(), [
    "activityProvenance",
    "externalActions",
    "idempotency",
    "runtimeResourceMutations",
    "runtimeResourceSnapshots"
  ]);
  assert.equal(ledger.idempotency, repositories.idempotency);
  assert.equal(ledger.runtimeResourceMutations, repositories.runtimeResourceMutations);
  assert.equal(ledger.runtimeResourceSnapshots, repositories.runtimeResourceSnapshots);
  assert.equal(ledger.externalActions, externalActions);
  assert.equal(ledger.activityProvenance, activityProvenance);

  for (const relativePath of [
    "src/application/runtime-resource-inventory-service.ts",
    "src/application/runtime-resource-mutation-public-service.ts",
    "src/application/runtime-resource-mutation-service.ts",
    "src/application/runtime-resource-services.ts"
  ]) {
    const source = fs.readFileSync(path.resolve(relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /continuity\/repositories\/index/,
      `${relativePath} must depend on GovernanceLedger rather than ContinuityRepositories`
    );
    assert.match(
      source,
      /governance-ledger/,
      `${relativePath} must declare the GovernanceLedger boundary explicitly`
    );
  }
} finally {
  governanceDatabase.close();
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_GOVERNANCE_LEDGER_OK\n");
