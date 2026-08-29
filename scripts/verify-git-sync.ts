import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  gitSync,
  type GovernedGitCommandRunner
} from "../src/core/git-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import {
  GOVERNED_GIT_CONFIG_ARGS,
  governedSshCommand
} from "../src/core/git-process-policy.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";

function stripGovernedConfig(args: string[]): string[] {
  let index = 0;
  while (args[index] === "-c" && index + 1 < args.length) {
    index += 2;
  }
  return args.slice(index);
}

interface RunnerOptions {
  head?: string;
  upstreamHead?: string;
  topLevel?: string;
  branch?: string | null;
  remote?: string;
  mergeRef?: string;
  remoteUrl?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  diffPaths?: string[];
  credentialHelpers?: string[];
  filteredPaths?: string[];
}

class StatefulGitRunner implements GovernedGitCommandRunner {
  head: string;
  upstreamHead: string;
  topLevel: string | null;
  branch: string | null;
  remote: string;
  mergeRef: string;
  remoteUrl: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  diffPaths: string[];
  credentialHelpers: string[];
  filteredPaths: string[];
  readonly calls: Array<{
    args: string[];
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }> = [];

  constructor(options: RunnerOptions = {}) {
    this.head = options.head ?? "1111111111111111111111111111111111111111";
    this.upstreamHead = options.upstreamHead ?? "2222222222222222222222222222222222222222";
    this.topLevel = options.topLevel ?? null;
    this.branch = options.branch === undefined ? "main" : options.branch;
    this.remote = options.remote ?? "origin";
    this.mergeRef = options.mergeRef ?? "refs/heads/main";
    this.remoteUrl = options.remoteUrl ?? "https://example.invalid/chatcockpit.git";
    this.ahead = options.ahead ?? 0;
    this.behind = options.behind ?? 0;
    this.dirty = options.dirty ?? false;
    this.diffPaths = options.diffPaths ?? ["src/remote.ts"];
    this.credentialHelpers = options.credentialHelpers ?? ["osxkeychain"];
    this.filteredPaths = options.filteredPaths ?? [];
  }

  run(input: {
    repoRoot: string;
    args: string[];
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }): { status: number | null; stdout: string; stderr: string } {
    this.calls.push({
      args: [...input.args],
      timeoutMs: input.timeoutMs,
      env: { ...input.env }
    });
    const args = stripGovernedConfig(input.args);

    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { status: 0, stdout: `${this.topLevel ?? input.repoRoot}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { status: 0, stdout: `${this.head}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "@{upstream}") {
      return { status: 0, stdout: `${this.upstreamHead}\n`, stderr: "" };
    }
    if (args[0] === "symbolic-ref") {
      if (!this.branch) {
        return { status: 1, stdout: "", stderr: "detached\n" };
      }
      return { status: 0, stdout: `${this.branch}\n`, stderr: "" };
    }
    if (args[0] === "config" && args[1] === "--get-regexp") {
      const pattern = args[2] ?? "";
      if (pattern.includes("credential")) {
        if (!this.credentialHelpers.length) {
          return { status: 1, stdout: "", stderr: "" };
        }
        return {
          status: 0,
          stdout: this.credentialHelpers
            .map((helper) => `credential.helper ${helper}`)
            .join("\n") + "\n",
          stderr: ""
        };
      }
    }
    if (args.includes("check-attr")) {
      const separator = args.lastIndexOf("--");
      const paths = separator >= 0 ? args.slice(separator + 1) : [];
      return {
        status: 0,
        stdout: paths
          .flatMap((filePath) => [
            filePath,
            "filter",
            this.filteredPaths.includes(filePath) ? "unsafe-test" : "unspecified"
          ])
          .join("\0") + (paths.length ? "\0" : ""),
        stderr: ""
      };
    }
    if (args[0] === "config" && args[1] === "--get") {
      if (args[2] === `branch.${this.branch}.remote`) {
        return { status: 0, stdout: `${this.remote}\n`, stderr: "" };
      }
      if (args[2] === `branch.${this.branch}.merge`) {
        return { status: 0, stdout: `${this.mergeRef}\n`, stderr: "" };
      }
    }
    if (args[0] === "remote" && args[1] === "get-url") {
      return { status: 0, stdout: `${this.remoteUrl}\n`, stderr: "" };
    }
    if (args[0] === "status" && args[1] === "--porcelain") {
      return {
        status: 0,
        stdout: this.dirty ? " M src/fixture.ts\n" : "",
        stderr: ""
      };
    }
    if (args[0] === "rev-list") {
      return {
        status: 0,
        stdout: `${this.ahead}\t${this.behind}\n`,
        stderr: ""
      };
    }
    if (args[0] === "diff" && args.includes("--name-only")) {
      return {
        status: 0,
        stdout: this.diffPaths.join("\n") + (this.diffPaths.length ? "\n" : ""),
        stderr: ""
      };
    }
    if (args.includes("fetch")) {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("merge")) {
      if (this.ahead > 0 || this.behind <= 0) {
        return { status: 1, stdout: "", stderr: "not fast-forwardable\n" };
      }
      this.head = this.upstreamHead;
      this.behind = 0;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("worktree") && args.includes("prune")) {
      return { status: 0, stdout: "", stderr: "" };
    }

    return {
      status: 1,
      stdout: "",
      stderr: `unexpected git invocation: ${args.join(" ")}\n`
    };
  }
}

function callWith(runner: StatefulGitRunner, includes: string): StatefulGitRunner["calls"][number][] {
  return runner.calls.filter((call) => call.args.includes(includes));
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-git-sync-"));
const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
const dangerousGitEnvKeys = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0"
] as const;
const previousDangerousGitEnv = Object.fromEntries(
  dangerousGitEnvKeys.map((key) => [key, process.env[key]])
) as Record<(typeof dangerousGitEnvKeys)[number], string | undefined>;

try {
  const paths = buildPaths(tempRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(tempRoot, ".chatcockpit-test-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [tempRoot],
        repoMappings: { primary: { path: tempRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.GIT_DIR = "/tmp/chatcockpit-evil-git-dir";
  process.env.GIT_WORK_TREE = "/tmp/chatcockpit-evil-worktree";
  process.env.GIT_INDEX_FILE = "/tmp/chatcockpit-evil-index";
  process.env.GIT_SSH_COMMAND = "sh -c 'exit 99'";
  process.env.GIT_CONFIG_PARAMETERS = "'core.sshCommand'='sh -c exit 95'";
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.sshCommand";
  process.env.GIT_CONFIG_VALUE_0 = "sh -c 'exit 98'";

  const mismatchedRootRunner = new StatefulGitRunner({ topLevel: os.tmpdir() });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fetch" }, mismatchedRootRunner),
    /repository root does not match the allowlisted workspace root/
  );
  assert.equal(callWith(mismatchedRootRunner, "fetch").length, 0);

  const fetchRunner = new StatefulGitRunner({ behind: 2 });
  const fetched = gitSync(
    paths,
    { repoId: "primary", action: "fetch", prune: false },
    fetchRunner
  );
  assert.equal(fetched.state, "fetched");
  assert.equal(fetched.changed, false);
  assert.equal(fetched.ahead, 0);
  assert.equal(fetched.behind, 2);
  assert.equal(fetched.upstreamRemote, "origin");
  const fetchCalls = callWith(fetchRunner, "fetch");
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0]?.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "fetch",
    "--no-recurse-submodules",
    "origin"
  ]);
  assert.equal(fetchCalls[0]?.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(fetchCalls[0]?.env.GIT_ALLOW_PROTOCOL, "https:ssh");
  assert.equal(fetchCalls[0]?.env.GIT_SSH_COMMAND, governedSshCommand());
  assert.equal(fetchCalls[0]?.env.GIT_ATTR_NOSYSTEM, "1");
  assert.equal(fetchCalls[0]?.env.GIT_DIR, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_WORK_TREE, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_INDEX_FILE, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_CONFIG_COUNT, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_CONFIG_KEY_0, undefined);
  assert.equal(fetchCalls[0]?.env.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(callWith(fetchRunner, "merge").length, 0);

  const fastForwardRunner = new StatefulGitRunner({ behind: 2 });
  const fastForwarded = gitSync(
    paths,
    { repoId: "primary", action: "fast-forward" },
    fastForwardRunner
  );
  assert.equal(fastForwarded.state, "fast-forwarded");
  assert.equal(fastForwarded.changed, true);
  assert.equal(fastForwarded.headBefore, "1111111111111111111111111111111111111111");
  assert.equal(fastForwarded.headAfter, "2222222222222222222222222222222222222222");
  assert.equal(fastForwarded.ahead, 0);
  assert.equal(fastForwarded.behind, 0);
  assert.deepEqual(fastForwarded.paths, ["src/remote.ts"]);
  assert.deepEqual(callWith(fastForwardRunner, "fetch")[0]?.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "fetch",
    "--no-recurse-submodules",
    "--prune",
    "origin"
  ]);
  assert.deepEqual(callWith(fastForwardRunner, "merge")[0]?.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "merge",
    "--ff-only",
    "@{upstream}"
  ]);

  const dirtyRunner = new StatefulGitRunner({ behind: 1, dirty: true });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fast-forward" }, dirtyRunner),
    /completely clean worktree and index/
  );
  assert.equal(callWith(dirtyRunner, "fetch").length, 0);

  const filteredRunner = new StatefulGitRunner({
    behind: 1,
    filteredPaths: ["src/remote.ts"]
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fast-forward" }, filteredRunner),
    /refuses paths with external filter attributes/
  );
  assert.equal(callWith(filteredRunner, "fetch").length, 1);
  assert.equal(callWith(filteredRunner, "merge").length, 0);

  const attributesChangeRunner = new StatefulGitRunner({
    behind: 1,
    diffPaths: [".gitattributes", "src/remote.ts"]
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fast-forward" }, attributesChangeRunner),
    /refuses upstream \.gitattributes changes/
  );
  assert.equal(callWith(attributesChangeRunner, "fetch").length, 1);
  assert.equal(callWith(attributesChangeRunner, "merge").length, 0);

  const unsafeUpstreamPathRunner = new StatefulGitRunner({
    behind: 1,
    diffPaths: ["src/remote.ts", ".env"]
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fast-forward" }, unsafeUpstreamPathRunner),
    /refuses upstream changes to public-unsafe paths/
  );
  assert.equal(callWith(unsafeUpstreamPathRunner, "fetch").length, 1);
  assert.equal(callWith(unsafeUpstreamPathRunner, "merge").length, 0);
  assert.equal(unsafeUpstreamPathRunner.head, "1111111111111111111111111111111111111111");

  const divergedRunner = new StatefulGitRunner({ ahead: 1, behind: 1 });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fast-forward" }, divergedRunner),
    /refuses diverged local and upstream history/
  );
  assert.equal(callWith(divergedRunner, "fetch").length, 1);
  assert.equal(callWith(divergedRunner, "merge").length, 0);

  const aheadRunner = new StatefulGitRunner({ ahead: 2, behind: 0 });
  const ahead = gitSync(
    paths,
    { repoId: "primary", action: "fast-forward", prune: false },
    aheadRunner
  );
  assert.equal(ahead.state, "ahead");
  assert.equal(ahead.changed, false);
  assert.equal(ahead.ahead, 2);
  assert.equal(callWith(aheadRunner, "merge").length, 0);
  assert.equal(callWith(aheadRunner, "fetch")[0]?.args.includes("--prune"), false);

  const pruneRunner = new StatefulGitRunner();
  const pruned = gitSync(
    paths,
    { repoId: "primary", action: "worktree-prune" },
    pruneRunner
  );
  assert.equal(pruned.state, "worktree-pruned");
  assert.equal(pruned.changed, false);
  assert.equal(pruned.upstreamRemote, null);
  assert.deepEqual(callWith(pruneRunner, "worktree")[0]?.args, [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "worktree",
    "prune"
  ]);
  assert.equal(callWith(pruneRunner, "fetch").length, 0);

  const unsafeRemoteRunner = new StatefulGitRunner({
    remoteUrl: "file:///tmp/chatcockpit.git"
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fetch" }, unsafeRemoteRunner),
    /only supports configured HTTPS or SSH remotes/
  );
  assert.equal(callWith(unsafeRemoteRunner, "fetch").length, 0);

  const unsafeSshPathRunner = new StatefulGitRunner({
    remoteUrl: "git@example.invalid:owner/repo.git;touch-pwned"
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fetch" }, unsafeSshPathRunner),
    /only supports configured HTTPS or SSH remotes/
  );
  assert.equal(callWith(unsafeSshPathRunner, "fetch").length, 0);

  const unsafeCredentialRunner = new StatefulGitRunner({
    credentialHelpers: ["!sh -c 'exit 97'"]
  });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fetch" }, unsafeCredentialRunner),
    /refuses non-allowlisted credential helpers/
  );
  assert.equal(callWith(unsafeCredentialRunner, "fetch").length, 0);

  const detachedRunner = new StatefulGitRunner({ branch: null });
  assert.throws(
    () => gitSync(paths, { repoId: "primary", action: "fetch" }, detachedRunner),
    /requires an attached branch/
  );
  assert.equal(callWith(detachedRunner, "fetch").length, 0);

  console.log("VERIFY_GIT_SYNC_OK");
} finally {
  if (previousConfigPath === undefined) {
    delete process.env.CHATCOCKPIT_CONFIG_PATH;
  } else {
    process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  }
  for (const key of dangerousGitEnvKeys) {
    const previous = previousDangerousGitEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
