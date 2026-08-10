import assert from "node:assert/strict";
import fs from "node:fs";

import { buildOperationContext } from "../src/application/operation-context.ts";
import { buildRuntimeResourceMutationProvenance } from "../src/application/runtime-resource-mutation-provenance.ts";

const context = buildOperationContext({
  requestId: "request-001",
  actorType: "remote-mcp",
  actorId: "client-subject",
  now: "2026-08-10T18:00:00.000Z"
});
const provenance = buildRuntimeResourceMutationProvenance(context);
assert.equal(provenance.actorType, "remote-mcp");
assert.match(provenance.actorIdentityHash!, /^[a-f0-9]{64}$/);
assert.match(provenance.requestIdentityHash, /^[a-f0-9]{64}$/);

const replayContext = buildOperationContext({
  requestId: "request-001",
  actorType: "remote-mcp",
  actorId: "client-subject",
  now: "2026-08-10T18:01:00.000Z"
});
assert.deepEqual(
  buildRuntimeResourceMutationProvenance(replayContext),
  provenance,
  "Mutation provenance must not depend on wall-clock time"
);

const differentActorType = buildRuntimeResourceMutationProvenance(
  buildOperationContext({
    requestId: "request-001",
    actorType: "rest-api",
    actorId: "client-subject"
  })
);
assert.notEqual(differentActorType.actorIdentityHash, provenance.actorIdentityHash);
assert.notEqual(differentActorType.requestIdentityHash, provenance.requestIdentityHash);

const anonymousActor = buildRuntimeResourceMutationProvenance(
  buildOperationContext({
    requestId: "request-anonymous",
    actorType: "local-ui",
    actorId: null
  })
);
assert.equal(anonymousActor.actorIdentityHash, null);
assert.match(anonymousActor.requestIdentityHash, /^[a-f0-9]{64}$/);

const serialized = JSON.stringify(provenance);
assert.equal(serialized.includes("client-subject"), false);
assert.equal(serialized.includes("request-001"), false);

const unrelatedSecret = "Bearer secret-token-material-that-must-not-affect-provenance";
const contextWithUnrelatedSecret = {
  ...context,
  authorization: unrelatedSecret,
  refreshToken: "refresh-secret-material"
};
assert.deepEqual(
  buildRuntimeResourceMutationProvenance(contextWithUnrelatedSecret),
  provenance,
  "Provenance hashing must ignore unrelated fields outside the OperationContext contract"
);
assert.equal(JSON.stringify(provenance).includes("secret-token-material"), false);
assert.equal(JSON.stringify(provenance).includes("refresh-secret-material"), false);

const source = fs.readFileSync(
  new URL("../src/application/runtime-resource-mutation-provenance.ts", import.meta.url),
  "utf8"
);
for (const forbidden of ["process.env", "authorization", "bearer", "accessToken", "refreshToken"]) {
  assert.equal(
    source.toLowerCase().includes(forbidden.toLowerCase()),
    false,
    `Provenance helper must not inspect credential material: ${forbidden}`
  );
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_PROVENANCE_OK\n");
