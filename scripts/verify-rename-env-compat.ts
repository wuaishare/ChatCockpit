import assert from "node:assert/strict";

import {
  IdentityEnvConflictError,
  RUNTIME_IDENTITY_ENV,
  readIdentityEnv
} from "../src/core/identity-env.js";
import { buildDistributionContext } from "../src/core/distribution-context.js";
import { isAuthRequired, isExposedMode } from "../src/server/auth.js";
import { resolveOAuthPublicConfig } from "../src/auth/oauth-config.js";
import { isResourceMutationExposureEnabled } from "../src/server/runtime-resource-mutation-policy.js";

const empty = {};
assert.equal(readIdentityEnv("API_TOKEN", empty), undefined);
assert.equal(
  readIdentityEnv("API_TOKEN", { TOKENPILOT_API_TOKEN: "legacy-secret" }),
  "legacy-secret"
);
assert.equal(
  readIdentityEnv("API_TOKEN", { CHATCOCKPIT_API_TOKEN: "target-secret" }),
  "target-secret"
);
assert.equal(
  readIdentityEnv("API_TOKEN", {
    TOKENPILOT_API_TOKEN: "same-secret",
    CHATCOCKPIT_API_TOKEN: "same-secret"
  }),
  "same-secret"
);
assert.equal(
  readIdentityEnv("PUBLIC_BASE_URL", {
    TOKENPILOT_PUBLIC_BASE_URL: "   ",
    CHATCOCKPIT_PUBLIC_BASE_URL: "https://example.invalid"
  }),
  "https://example.invalid"
);

let conflict: unknown;
try {
  readIdentityEnv("API_TOKEN", {
    TOKENPILOT_API_TOKEN: "legacy-do-not-print",
    CHATCOCKPIT_API_TOKEN: "target-do-not-print"
  });
} catch (error) {
  conflict = error;
}
assert.ok(conflict instanceof IdentityEnvConflictError);
assert.equal(conflict.code, "IDENTITY_ENV_CONFLICT");
assert.match(conflict.message, /TOKENPILOT_API_TOKEN/);
assert.match(conflict.message, /CHATCOCKPIT_API_TOKEN/);
assert.doesNotMatch(conflict.message, /legacy-do-not-print/);
assert.doesNotMatch(conflict.message, /target-do-not-print/);

assert.equal(RUNTIME_IDENTITY_ENV.CONFIG_PATH.legacy, "TOKENPILOT_CONFIG_PATH");
assert.equal(RUNTIME_IDENTITY_ENV.CONFIG_PATH.target, "CHATCOCKPIT_CONFIG_PATH");
assert.equal(RUNTIME_IDENTITY_ENV.LAN_TLS_PORT.legacy, "TOKENPILOT_LAN_TLS_PORT");
assert.equal(RUNTIME_IDENTITY_ENV.LAN_TLS_PORT.target, "CHATCOCKPIT_LAN_TLS_PORT");
assert.equal(readIdentityEnv("LAN_TLS_PORT", { CHATCOCKPIT_LAN_TLS_PORT: "4319" }), "4319");

const targetOnlyEnv = {
  CHATCOCKPIT_DISTRIBUTION_MODE: "packaged",
  CHATCOCKPIT_INSTALL_ROOT: "/tmp/chatcockpit-install",
  CHATCOCKPIT_STATE_ROOT: "/tmp/chatcockpit-state",
  CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: "/tmp/chatcockpit-workspace",
  CHATCOCKPIT_NODE_BIN: process.execPath,
  CHATCOCKPIT_CONFIG_PATH: "/tmp/chatcockpit-config.json"
};
const targetContext = buildDistributionContext({}, targetOnlyEnv);
assert.equal(targetContext.mode, "packaged");
assert.equal(targetContext.stateRoot.endsWith("chatcockpit-state"), true);

assert.equal(isExposedMode({ CHATCOCKPIT_EXPOSED: "true" }), true);
assert.equal(
  isAuthRequired({ CHATCOCKPIT_API_TOKEN: "target-only-secret" }),
  true
);
assert.equal(
  isResourceMutationExposureEnabled({
    CHATCOCKPIT_EXPOSED: "true",
    CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED: "true"
  }),
  true
);

const oauth = resolveOAuthPublicConfig({
  CHATCOCKPIT_PUBLIC_BASE_URL: "https://example.invalid"
});
assert.equal(oauth?.resource, "https://example.invalid/mcp");

assert.throws(
  () =>
    isAuthRequired({
      TOKENPILOT_API_TOKEN: "one",
      CHATCOCKPIT_API_TOKEN: "two"
    }),
  IdentityEnvConflictError
);

process.stdout.write("VERIFY_RENAME_ENV_COMPAT_OK\n");
