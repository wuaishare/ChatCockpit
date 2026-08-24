import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asyncJobQueueSchema } from "../src/contracts/async-job.ts";
import { buildGptConfig } from "../src/core/gpt-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gpt = buildGptConfig("zh-CN", root);

assert.match(gpt.instructions, /当前 (?:ChatGPT|调用方).*持有模型循环/);
assert.match(gpt.instructions, /只有用户明确.*(?:Delegate|Transfer|委派|转交)/);
assert.doesNotMatch(gpt.instructions, /Codex Native 可用时优先 Start\/Resume/);
assert.doesNotMatch(gpt.instructions, /较大开发任务.*worktreePolicy=always/);

const parsed = asyncJobQueueSchema.parse({
  taskId: "task_test",
  sessionId: "session_test",
  expectedTaskRevision: 1,
  expectedSessionRevision: 1,
  repoId: "primary",
  title: "Model loop ownership fixture",
  instructions: "Verify defaults",
  idempotencyKey: "model-loop-fixture-0001"
});
assert.equal(parsed.worktreePolicy, "never");
const sourceChecks: Array<[string, RegExp]> = [
  ["src/server/app.ts", /worktreePolicy: z\.enum\(\["auto", "always", "never"\]\)\.default\("never"\)/],
  ["src/cli/index.ts", /getFlag\("--worktree-policy"\) \|\| "never"/],
  ["src/application/async-job-service.ts", /payload\.worktreePolicy \?\? "never"/],
  ["src/core/codex-run.ts", /worktreePolicy: payload\.worktreePolicy \?\? "never"/]
];
for (const [relativePath, pattern] of sourceChecks) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(source, pattern, `${relativePath} must preserve native-checkout-first default`);
}

const coordinationSource = fs.readFileSync(
  path.join(root, "src/application/project-development-routing-service.ts"),
  "utf8"
);
assert.match(coordinationSource, /defaultOwner: "caller"/);
assert.match(coordinationSource, /implicitCodexTurnAllowed: false/);
assert.match(coordinationSource, /codexTurnRequiresExplicitTransfer: true/);
assert.match(coordinationSource, /worktreeRequiresExplicitOptIn: true/);

process.stdout.write("model loop ownership verification passed\n");
