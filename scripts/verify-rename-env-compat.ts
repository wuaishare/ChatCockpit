import assert from "node:assert/strict";

import {
  IdentityEnvConflictError,
  RUNTIME_IDENTITY_ENV,
  readIdentityEnv
} from "../src/core/identity-env.js";

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

process.stdout.write("VERIFY_RENAME_ENV_COMPAT_OK\n");
