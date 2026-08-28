import assert from "node:assert/strict";

import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
  resolveShellCommandTimeoutMs
} from "../src/core/shell-api.ts";

assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 45_000);
assert.equal(MAX_COMMAND_TIMEOUT_MS, 120_000);
assert.equal(resolveShellCommandTimeoutMs(), 45_000);
assert.equal(resolveShellCommandTimeoutMs(60_000), 60_000);
assert.equal(resolveShellCommandTimeoutMs(120_000), 120_000);
assert.throws(() => resolveShellCommandTimeoutMs(999), /between 1000 and 120000/);
assert.throws(() => resolveShellCommandTimeoutMs(120_001), /between 1000 and 120000/);
assert.throws(() => resolveShellCommandTimeoutMs(1_500.5), /between 1000 and 120000/);

process.stdout.write("VERIFY_SHELL_API_OK\n");
