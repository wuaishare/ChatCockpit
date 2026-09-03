import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gitBranch, type GovernedGitCommandRunner } from "../src/core/git-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { GOVERNED_GIT_CONFIG_ARGS } from "../src/core/git-process-policy.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";

function stripGovernedConfig(args: string[]): string[] {
  let index = 0;
  while (args[index] === "-c" && index + 1 < args.length) index += 2;
  return args.slice(index);
}

interface RunnerOptions {
  topLevel?: string;
  branch?: string | null;
  dirty?: boolean;
  diffPaths?: string[];
  filteredPaths?: string[];
}

class BranchGitRunner implements GovernedGitCommandRunner {
  topLevel: string | null;
  branch: string | null;
  dirty: boolean;
  diffPaths: string[];
  filteredPaths: string[];
  readonly branches = new Map<string, string>([
    ["main", "1111111111111111111111111111111111111111"],
    ["feature-existing", "2222222222222222222222222222222222222222"],
    ["merged-feature", "3333333333333333333333333333333333333333"]
  ]);
  readonly calls: string[][] = [];

  constructor(options: RunnerOptions = {}) {
    this.topLevel = options.topLevel ?? null;
    this.branch = options.branch === undefined ? "main" : options.branch;
    this.dirty = options.dirty ?? false;
    this.diffPaths = options.diffPaths ?? ["src/feature.ts"];
    this.filteredPaths = options.filteredPaths ?? [];
  }

  private currentHead(): string {
    return this.branch ? this.branches.get(this.branch) ?? "" : "1111111111111111111111111111111111111111";
  }

  run(input: {
    repoRoot: string;
    args: string[];
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }): { status: number | null; stdout: string; stderr: string } {
    this.calls.push([...input.args]);
    const args = stripGovernedConfig(input.args);

    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { status: 0, stdout: `${this.topLevel ?? input.repoRoot}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { status: 0, stdout: `${this.currentHead()}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse" && (args[1] ?? "").startsWith("refs/heads/")) {
      const name = (args[1] ?? "").slice("refs/heads/".length);
      const head = this.branches.get(name);
      return head
        ? { status: 0, stdout: `${head}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "missing\n" };
    }
    if (args[0] === "symbolic-ref") {
      return this.branch
        ? { status: 0, stdout: `${this.branch}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "detached\n" };
    }
    if (args[0] === "check-ref-format" && args[1] === "--branch") {
      const value = args[2] ?? "";
      const valid = Boolean(value) && !value.startsWith("-") && !value.includes(" ") && !value.includes("..") && !value.includes("@{");
      return valid
        ? { status: 0, stdout: `${value}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "invalid\n" };
    }
    if (args[0] === "show-ref" && args[1] === "--verify" && args[2] === "--quiet") {
      const name = (args[3] ?? "").replace(/^refs\/heads\//, "");
      return this.branches.has(name)
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    if (args[0] === "status" && args[1] === "--porcelain") {
      return { status: 0, stdout: this.dirty ? " M src/dirty.ts\n" : "", stderr: "" };
    }
    if (args[0] === "diff" && args.includes("--name-only")) {
      return { status: 0, stdout: this.diffPaths.join("\n") + (this.diffPaths.length ? "\n" : ""), stderr: "" };
    }
    if (args.includes("check-attr")) {
      const separator = args.lastIndexOf("--");
      const paths = separator >= 0 ? args.slice(separator + 1) : [];
      return {
        status: 0,
        stdout: paths.flatMap((filePath) => [filePath, "filter", this.filteredPaths.includes(filePath) ? "unsafe-test" : "unspecified"]).join("\0") + (paths.length ? "\0" : ""),
        stderr: ""
      };
    }
    if (args[0] === "switch" && args[1] === "-c") {
      const target = args[2] ?? "";
      this.branches.set(target, this.currentHead());
      this.branch = target;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "switch" && args[1] === "--no-guess") {
      const target = args[2] ?? "";
      if (!this.branches.has(target)) return { status: 1, stdout: "", stderr: "missing\n" };
      this.branch = target;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "branch" && args[1] === "-d" && args[2] === "--") {
      const target = args[3] ?? "";
      this.branches.delete(target);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected git args: ${args.join(" ")}\n` };
  }
}

function callsWith(runner: BranchGitRunner, subcommand: string): string[][] {
  return runner.calls.filter((args) => stripGovernedConfig(args)[0] === subcommand);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-git-branch-"));
const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
try {
  const paths = buildPaths(tempRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(tempRoot, ".chatcockpit-test-config.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [tempRoot],
    repoMappings: { primary: { path: tempRoot } }
  }, null, 2)}\n`, "utf8");
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;

  const createdRunner = new BranchGitRunner();
  const created = gitBranch(paths, {
    repoId: "primary",
    action: "create",
    branch: "selfboot/branch-lifecycle",
    expectedCurrentBranch: "main"
  }, createdRunner);
  assert.equal(created.state, "created-and-switched");
  assert.equal(created.branchBefore, "main");
  assert.equal(created.branchAfter, "selfboot/branch-lifecycle");
  assert.equal(created.headBefore, created.headAfter);
  assert.deepEqual(created.paths, []);
  assert.deepEqual(callsWith(createdRunner, "switch")[0], [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "switch", "-c", "selfboot/branch-lifecycle"
  ]);

  const driftRunner = new BranchGitRunner();
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "create", branch: "new-branch", expectedCurrentBranch: "develop"
  }, driftRunner), /current-branch drift/);
  assert.equal(callsWith(driftRunner, "switch").length, 0);

  const dirtyRunner = new BranchGitRunner({ dirty: true });
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "create", branch: "dirty-branch"
  }, dirtyRunner), /completely clean worktree and index/);
  assert.equal(callsWith(dirtyRunner, "switch").length, 0);

  const existingRunner = new BranchGitRunner();
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "create", branch: "feature-existing"
  }, existingRunner), /refuses an existing local branch/);

  const switchRunner = new BranchGitRunner();
  const switched = gitBranch(paths, {
    repoId: "primary", action: "switch", branch: "feature-existing", expectedCurrentBranch: "main"
  }, switchRunner);
  assert.equal(switched.state, "switched");
  assert.equal(switched.branchAfter, "feature-existing");
  assert.equal(switched.headAfter, "2222222222222222222222222222222222222222");
  assert.deepEqual(switched.paths, ["src/feature.ts"]);
  assert.deepEqual(callsWith(switchRunner, "switch")[0], [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "switch", "--no-guess", "feature-existing"
  ]);

  const sameRunner = new BranchGitRunner();
  const same = gitBranch(paths, { repoId: "primary", action: "switch", branch: "main" }, sameRunner);
  assert.equal(same.state, "already-current");
  assert.equal(same.changed, false);
  assert.equal(callsWith(sameRunner, "switch").length, 0);

  const missingRunner = new BranchGitRunner();
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "switch", branch: "remote-only"
  }, missingRunner), /requires an existing local branch/);
  assert.equal(callsWith(missingRunner, "switch").length, 0);

  const unsafeRunner = new BranchGitRunner({ diffPaths: ["src/feature.ts", ".env"] });
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "switch", branch: "feature-existing"
  }, unsafeRunner), /public-unsafe paths/);
  assert.equal(callsWith(unsafeRunner, "switch").length, 0);

  const attributesRunner = new BranchGitRunner({ diffPaths: [".gitattributes", "src/feature.ts"] });
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "switch", branch: "feature-existing"
  }, attributesRunner), /\.gitattributes changes/);
  assert.equal(callsWith(attributesRunner, "switch").length, 0);

  const filteredRunner = new BranchGitRunner({ filteredPaths: ["src/feature.ts"] });
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "switch", branch: "feature-existing"
  }, filteredRunner), /external filter attributes/);
  assert.equal(callsWith(filteredRunner, "switch").length, 0);

  const currentDeleteRunner = new BranchGitRunner();
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "delete", branch: "main"
  }, currentDeleteRunner), /refuses the current branch/);

  const deleteRunner = new BranchGitRunner();
  const deleted = gitBranch(paths, {
    repoId: "primary", action: "delete", branch: "merged-feature", expectedCurrentBranch: "main"
  }, deleteRunner);
  assert.equal(deleted.state, "deleted");
  assert.equal(deleted.branchAfter, "main");
  assert.deepEqual(deleted.paths, []);
  assert.deepEqual(callsWith(deleteRunner, "branch")[0], [
    ...GOVERNED_GIT_CONFIG_ARGS,
    "branch", "-d", "--", "merged-feature"
  ]);
  assert.equal(deleteRunner.calls.some((args) => args.includes("-D") || args.includes("--force")), false);

  for (const invalid of ["-evil", "@{-1}", "bad..name", " bad"]) {
    const invalidRunner = new BranchGitRunner();
    assert.throws(() => gitBranch(paths, {
      repoId: "primary", action: "create", branch: invalid
    }, invalidRunner), /branch name is invalid/);
    assert.equal(callsWith(invalidRunner, "switch").length, 0);
  }

  const detachedRunner = new BranchGitRunner({ branch: null });
  assert.throws(() => gitBranch(paths, {
    repoId: "primary", action: "create", branch: "detached-fix"
  }, detachedRunner), /requires an attached current branch/);

  console.log("VERIFY_GIT_BRANCH_OK");
} finally {
  if (previousConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
