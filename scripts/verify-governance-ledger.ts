import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { buildGovernanceLedger } from "../src/governance/governance-ledger.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-governance-ledger-"));
const database = new ContinuityDatabase({ path: path.join(root, "continuity.sqlite") });
try {
  const repositories = buildContinuityRepositories(database);
  const externalActions = new GovernedExternalActionRepository(database);
  const ledger = buildGovernanceLedger(repositories, externalActions);

  assert.deepEqual(Object.keys(ledger).sort(), [
    "externalActions",
    "idempotency",
    "runtimeResourceMutations",
    "runtimeResourceSnapshots"
  ]);
  assert.equal(ledger.idempotency, repositories.idempotency);
  assert.equal(ledger.runtimeResourceMutations, repositories.runtimeResourceMutations);
  assert.equal(ledger.runtimeResourceSnapshots, repositories.runtimeResourceSnapshots);
  assert.equal(ledger.externalActions, externalActions);

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
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_GOVERNANCE_LEDGER_OK\n");
