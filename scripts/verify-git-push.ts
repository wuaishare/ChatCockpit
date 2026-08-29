import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  gitPush,
  type GovernedGitCommandRunner
} from "../src/core/git-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import {
  GOVERNED_GIT_CONFIG_ARGS,
  governedSshCommand
} from "../src/core/git-process-policy.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";

function stripLeadingConfig(args: string[]): string[] {
  let index = 0;
  while (args[index] === "-c" && index + 1 < args.length) index += 2;
  return args.slice(index);
}

interface RunnerOptions {
  head?: string;
  upstreamHead?: string;
  topLevel?: string;
  branch?: string | null;
  remote?: string;
  mergeRef?: string;
  fetchUrls?: string[];
  pushUrls?: string[];
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  outgoingPaths?: string[];
  credentialHelpers?: string[];
  mirror?: string | null;
  pushOptions?: string[];
  remotePushOptions?: string[];
  receivepack?: string | null;
  shallow?: boolean;
  failPush?: boolean;
  mutateHeadAfterFetch?: boolean;
  mutateHeadAfterDiff?: boolean;
}

class PushGitRunner implements GovernedGitCommandRunner {
  head: string;
  upstreamHead: string;
  topLevel: string | null;
  branch: string | null;
  remote: string;
  mergeRef: string;
  fetchUrls: string[];
  pushUrls: string[];
  ahead: number;
  behind: number;
  dirty: boolean;
  outgoingPaths: string[];
  credentialHelpers: string[];
  mirror: string | null;
  pushOptions: string[];
  remotePushOptions: string[];
  receivepack: string | null;
  shallow: boolean;
  failPush: boolean;
  mutateHeadAfterFetch: boolean;
  mutateHeadAfterDiff: boolean;
  readonly calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];

  constructor(options: RunnerOptions = {}) {
    this.head = options.head ?? "1111111111111111111111111111111111111111";
    this.upstreamHead = options.upstreamHead ?? "2222222222222222222222222222222222222222";
    this.topLevel = options.topLevel ?? null;
    this.branch = options.branch === undefined ? "main" : options.branch;
    this.remote = options.remote ?? "origin";
    this.mergeRef = options.mergeRef ?? "refs/heads/main";
    this.fetchUrls = options.fetchUrls ?? ["https://example.invalid/chatcockpit.git"];
    this.pushUrls = options.pushUrls ?? [...this.fetchUrls];
    this.ahead = options.ahead ?? 2;
    this.behind = options.behind ?? 0;
    this.dirty = options.dirty ?? false;
    this.outgoingPaths = options.outgoingPaths ?? ["src/push-safe.ts", "README.md"];
    this.credentialHelpers = options.credentialHelpers ?? ["osxkeychain"];
    this.mirror = options.mirror ?? null;
    this.pushOptions = options.pushOptions ?? [];
    this.remotePushOptions = options.remotePushOptions ?? [];
    this.receivepack = options.receivepack ?? null;
    this.shallow = options.shallow ?? false;
    this.failPush = options.failPush ?? false;
    this.mutateHeadAfterFetch = options.mutateHeadAfterFetch ?? false;
    this.mutateHeadAfterDiff = options.mutateHeadAfterDiff ?? false;
  }

  run(input: {
    repoRoot: string;
    args: string[];
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }): { status: number | null; stdout: string; stderr: string } {
    this.calls.push({ args: [...input.args], env: { ...input.env } });
    const args = stripLeadingConfig(input.args);

    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { status: 0, stdout: `${this.topLevel ?? input.repoRoot}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { status: 0, stdout: `${this.head}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") {
      return { status: 0, stdout: `${this.shallow ? "true" : "false"}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "--git-path" && args[2] === "info/grafts") {
      return { status: 0, stdout: ".git/info/grafts\n", stderr: "" };
    }
    if (args[0] === "rev-parse" && (args[1] === "@{upstream}" || args[1] === "FETCH_HEAD")) {
      return { status: 0, stdout: `${this.upstreamHead}\n`, stderr: "" };
    }
    if (args[0] === "symbolic-ref") {
      return this.branch
        ? { status: 0, stdout: `${this.branch}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "detached\n" };
    }
    if (args[0] === "check-ref-format") {
      const ref = args[1] ?? "";
      const valid =
        /^refs\/(?:heads|remotes)\/[A-Za-z0-9._/-]+$/.test(ref) &&
        !ref.includes("..") &&
        !ref.includes("//") &&
        !ref.endsWith("/") &&
        !ref.endsWith(".");
      return valid
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 1, stdout: "", stderr: "invalid ref\n" };
    }
    if (args[0] === "config" && args[1] === "--get-regexp") {
      if (!(args[2] ?? "").includes("credential")) {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (!this.credentialHelpers.length) return { status: 1, stdout: "", stderr: "" };
      return {
        status: 0,
        stdout: this.credentialHelpers.map((value) => `credential.helper ${value}`).join("\n") + "\n",
        stderr: ""
      };
    }
    if (args[0] === "config" && args[1] === "--get") {
      const key = args[2] ?? "";
      if (key === `branch.${this.branch}.remote`) return { status: 0, stdout: `${this.remote}\n`, stderr: "" };
      if (key === `branch.${this.branch}.merge`) return { status: 0, stdout: `${this.mergeRef}\n`, stderr: "" };
      if (key === `remote.${this.remote}.mirror`) {
        return this.mirror === null
          ? { status: 1, stdout: "", stderr: "" }
          : { status: 0, stdout: `${this.mirror}\n`, stderr: "" };
      }
      if (key === `remote.${this.remote}.receivepack`) {
        return this.receivepack === null
          ? { status: 1, stdout: "", stderr: "" }
          : { status: 0, stdout: `${this.receivepack}\n`, stderr: "" };
      }
    }
    if (args[0] === "config" && args[1] === "--get-all") {
      const key = args[2] ?? "";
      const values = key === "push.pushOption"
        ? this.pushOptions
        : key === `remote.${this.remote}.pushOption`
          ? this.remotePushOptions
          : [];
      return values.length
        ? { status: 0, stdout: values.join("\n") + "\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    if (args[0] === "remote" && args[1] === "get-url") {
      const urls = args.includes("--push") ? this.pushUrls : this.fetchUrls;
      return urls.length
        ? { status: 0, stdout: urls.join("\n") + "\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing url\n" };
    }
    if (args[0] === "status" && args[1] === "--porcelain") {
      return { status: 0, stdout: this.dirty ? " M src/dirty.ts\n" : "", stderr: "" };
    }
    if (args[0] === "fetch") {
      if (this.mutateHeadAfterFetch) {
        this.head = "3333333333333333333333333333333333333333";
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "rev-list") {
      return { status: 0, stdout: `${this.ahead}\t${this.behind}\n`, stderr: "" };
    }
    if (args[0] === "diff" && args.includes("--name-only") && args.includes("-z")) {
      const stdout = this.outgoingPaths.join("\0") + (this.outgoingPaths.length ? "\0" : "");
      if (this.mutateHeadAfterDiff) {
        this.head = "3333333333333333333333333333333333333333";
      }
      return { status: 0, stdout, stderr: "" };
    }
    if (args[0] === "push") {
      return this.failPush
        ? { status: 1, stdout: "", stderr: "remote rejected\n" }
        : { status: 0, stdout: "ok\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}\n` };
  }
}

function callsWith(runner: PushGitRunner, token: string) {
  return runner.calls.filter((call) => stripLeadingConfig(call.args)[0] === token);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-git-push-"));
const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
const dangerousKeys = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_TRACE",
  "GIT_TRACE_CURL",
  "GIT_TRACE2_EVENT",
  "GIT_SSL_NO_VERIFY",
  "GIT_ATTR_SOURCE",
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0"
] as const;
const previousDangerous = Object.fromEntries(
  dangerousKeys.map((key) => [key, process.env[key]])
) as Record<(typeof dangerousKeys)[number], string | undefined>;

try {
  const paths = buildPaths(tempRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(tempRoot, ".chatcockpit-test-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [tempRoot],
    repoMappings: { primary: { path: tempRoot } }
  }));
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.GIT_DIR = "/tmp/evil-git-dir";
  process.env.GIT_WORK_TREE = "/tmp/evil-worktree";
  process.env.GIT_INDEX_FILE = "/tmp/evil-index";
  process.env.GIT_ASKPASS = "/tmp/evil-askpass";
  process.env.GIT_SSH = "/tmp/evil-ssh";
  process.env.GIT_SSH_COMMAND = "sh -c 'exit 99'";
  process.env.GIT_SSH_VARIANT = "plink";
  process.env.GIT_TRACE = "/tmp/evil-git-trace";
  process.env.GIT_TRACE_CURL = "/tmp/evil-git-curl-trace";
  process.env.GIT_TRACE2_EVENT = "/tmp/evil-git-trace2";
  process.env.GIT_SSL_NO_VERIFY = "1";
  process.env.GIT_ATTR_SOURCE = "HEAD~1";
  process.env.GIT_SHALLOW_FILE = "/tmp/evil-shallow";
  process.env.GIT_REPLACE_REF_BASE = "refs/evil-replace";
  process.env.GIT_CONFIG_PARAMETERS = "'push.followTags'='true'";
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "remote.origin.mirror";
  process.env.GIT_CONFIG_VALUE_0 = "true";

  const successRunner = new PushGitRunner();
  const pushed = gitPush(paths, { repoId: "primary" }, successRunner);
  assert.equal(pushed.state, "pushed");
  assert.equal(pushed.pushed, true);
  assert.equal(pushed.aheadBefore, 2);
  assert.equal(pushed.behindBefore, 0);
  assert.equal(pushed.head, "1111111111111111111111111111111111111111");
  assert.equal(pushed.upstreamBefore, "2222222222222222222222222222222222222222");
  assert.deepEqual(pushed.paths, ["README.md", "src/push-safe.ts"]);
  assert.equal(pushed.pathCount, 2);
  assert.equal(pushed.pathsTruncated, false);
  assert.equal(callsWith(successRunner, "fetch").length, 1);
  const fetchCall = callsWith(successRunner, "fetch")[0];
  assert.ok(fetchCall);
  assert.deepEqual(fetchCall.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "fetch",
    "--no-recurse-submodules",
    "--no-tags",
    "https://example.invalid/chatcockpit.git",
    "refs/heads/main"
  ]);
  assert.equal(fetchCall.args.includes("origin"), false);
  const pushCall = callsWith(successRunner, "push")[0];
  assert.ok(pushCall);
  assert.deepEqual(pushCall.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "-c", "push.followTags=false",
    "-c", "push.gpgSign=false",
    "-c", "push.recurseSubmodules=no",
    "push",
    "--porcelain",
    "--no-verify",
    "--recurse-submodules=no",
    "https://example.invalid/chatcockpit.git",
    "1111111111111111111111111111111111111111:refs/heads/main"
  ]);
  assert.equal(pushCall.args.includes("--force"), false);
  assert.equal(pushCall.args.includes("--tags"), false);
  assert.equal(pushCall.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(pushCall.env.GIT_ALLOW_PROTOCOL, "https:ssh");
  assert.equal(pushCall.env.GIT_SSH_COMMAND, governedSshCommand());
  assert.equal(pushCall.env.GIT_SSH_VARIANT, "ssh");
  assert.equal(pushCall.env.GIT_ATTR_NOSYSTEM, "1");
  assert.equal(pushCall.env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(pushCall.env.GIT_NO_REPLACE_OBJECTS, "1");
  for (const key of dangerousKeys) {
    if (key === "GIT_SSH_COMMAND" || key === "GIT_SSH_VARIANT") continue;
    assert.equal(pushCall.env[key], undefined, `${key} must not reach governed push`);
  }

  const upToDateRunner = new PushGitRunner({ ahead: 0, behind: 0 });
  const upToDate = gitPush(paths, { repoId: "primary" }, upToDateRunner);
  assert.equal(upToDate.state, "up-to-date");
  assert.equal(upToDate.pushed, false);
  assert.equal(upToDate.pathCount, 0);
  assert.equal(upToDate.pathsTruncated, false);
  assert.equal(callsWith(upToDateRunner, "push").length, 0);

  const dirtyRunner = new PushGitRunner({ dirty: true });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, dirtyRunner), /completely clean worktree and index/);
  assert.equal(callsWith(dirtyRunner, "fetch").length, 0);

  const shallowRunner = new PushGitRunner({ shallow: true });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, shallowRunner), /refuses shallow repository history/);
  assert.equal(callsWith(shallowRunner, "fetch").length, 0);

  fs.mkdirSync(path.join(tempRoot, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".git", "info", "grafts"), `${"a".repeat(40)}\n`, "utf8");
  const graftRunner = new PushGitRunner();
  assert.throws(() => gitPush(paths, { repoId: "primary" }, graftRunner), /refuses repository commit grafts/);
  assert.equal(callsWith(graftRunner, "fetch").length, 0);
  fs.rmSync(path.join(tempRoot, ".git"), { recursive: true, force: true });

  const detachedRunner = new PushGitRunner({ branch: null });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, detachedRunner), /requires an attached branch/);
  assert.equal(callsWith(detachedRunner, "push").length, 0);

  const optionRemoteRunner = new PushGitRunner({ remote: "-evil" });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, optionRemoteRunner), /configured remote branch upstream/);
  assert.equal(callsWith(optionRemoteRunner, "fetch").length, 0);

  const invalidRefRunner = new PushGitRunner({ mergeRef: "refs/heads/main:evil" });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, invalidRefRunner), /valid configured remote branch upstream/);
  assert.equal(callsWith(invalidRefRunner, "push").length, 0);

  const multiplePushUrls = new PushGitRunner({
    pushUrls: ["https://example.invalid/a.git", "https://example.invalid/b.git"]
  });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, multiplePushUrls), /exactly one configured HTTPS or SSH push URL/);
  assert.equal(callsWith(multiplePushUrls, "fetch").length, 0);

  const unsafePushUrl = new PushGitRunner({ pushUrls: ["file:///tmp/repo.git"] });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, unsafePushUrl), /exactly one configured HTTPS or SSH push URL/);
  assert.equal(callsWith(unsafePushUrl, "push").length, 0);

  const separatePushTarget = new PushGitRunner({
    pushUrls: ["https://push.example.invalid/chatcockpit.git"]
  });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, separatePushTarget), /push URL to match the configured upstream fetch URL/);
  assert.equal(callsWith(separatePushTarget, "fetch").length, 0);
  assert.equal(callsWith(separatePushTarget, "push").length, 0);

  for (const runner of [
    new PushGitRunner({ mirror: "true" }),
    new PushGitRunner({ pushOptions: ["ci.skip"] }),
    new PushGitRunner({ remotePushOptions: ["ci.skip"] }),
    new PushGitRunner({ receivepack: "sh -c evil" })
  ]) {
    assert.throws(() => gitPush(paths, { repoId: "primary" }, runner), /refuses/);
    assert.equal(callsWith(runner, "fetch").length, 0);
    assert.equal(callsWith(runner, "push").length, 0);
  }

  const behindRunner = new PushGitRunner({ ahead: 0, behind: 1 });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, behindRunner), /behind or diverged/);
  assert.equal(callsWith(behindRunner, "fetch").length, 1);
  assert.equal(callsWith(behindRunner, "push").length, 0);

  const divergedRunner = new PushGitRunner({ ahead: 1, behind: 1 });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, divergedRunner), /behind or diverged/);
  assert.equal(callsWith(divergedRunner, "push").length, 0);

  for (const outgoingPaths of [["src/safe.ts", ".env"], ["dist/archive.zip"]]) {
    const runner = new PushGitRunner({ outgoingPaths });
    assert.throws(() => gitPush(paths, { repoId: "primary" }, runner), /non-commit-safe paths/);
    assert.equal(callsWith(runner, "push").length, 0);
  }

  const manyOutgoingPaths = Array.from(
    { length: 550 },
    (_, index) => `src/generated/${String(index).padStart(3, "0")}.ts`
  );
  const manyPathsRunner = new PushGitRunner({ outgoingPaths: manyOutgoingPaths });
  const manyPathsPush = gitPush(paths, { repoId: "primary" }, manyPathsRunner);
  assert.equal(manyPathsPush.pathCount, 550);
  assert.equal(manyPathsPush.paths.length, 500);
  assert.equal(manyPathsPush.pathsTruncated, true);
  assert.equal(callsWith(manyPathsRunner, "push").length, 1);

  const unsafeCredentialRunner = new PushGitRunner({ credentialHelpers: ["!sh -c evil"] });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, unsafeCredentialRunner), /non-allowlisted credential helpers/);
  assert.equal(callsWith(unsafeCredentialRunner, "fetch").length, 0);

  const changedDuringFetchRunner = new PushGitRunner({ mutateHeadAfterFetch: true });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, changedDuringFetchRunner), /HEAD that changed during upstream verification/);
  assert.equal(callsWith(changedDuringFetchRunner, "push").length, 0);

  const changedHeadRunner = new PushGitRunner({ mutateHeadAfterDiff: true });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, changedHeadRunner), /HEAD that changed during push preparation/);
  assert.equal(callsWith(changedHeadRunner, "push").length, 0);

  const failedPushRunner = new PushGitRunner({ failPush: true });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, failedPushRunner), /Governed Git operation failed/);
  assert.equal(callsWith(failedPushRunner, "push").length, 1);

  const wrongRootRunner = new PushGitRunner({ topLevel: os.tmpdir() });
  assert.throws(() => gitPush(paths, { repoId: "primary" }, wrongRootRunner), /repository root does not match/);
  assert.equal(callsWith(wrongRootRunner, "fetch").length, 0);

  console.log("VERIFY_GIT_PUSH_OK");
} finally {
  if (previousConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  for (const key of dangerousKeys) {
    const previous = previousDangerous[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
