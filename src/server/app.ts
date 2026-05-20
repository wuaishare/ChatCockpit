import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

import type {
  JobRecord,
  TaskPackInput,
  TokenPilotHealthStatus,
  TokenPilotJobPayload,
  TokenPilotPaths,
  TokenPilotPublicJobRecord
} from "../types.js";
import { readRepoFile, readRepoFiles } from "../core/files-api.js";
import { createJob, getJob, listJobs } from "../core/jobs.js";
import {
  isExposedMode,
  isAuthRequired,
  tokenPilotAuthPlugin,
  validateServerAuthConfig
} from "./auth.js";

const taskPackSchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  contextSummary: z.string().optional(),
  mustInspect: z.array(z.string()).optional(),
  mayInspect: z.array(z.string()).optional(),
  mustNotModify: z.array(z.string()).optional(),
  verificationCommands: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional()
});

const packJobSchema = z
  .object({
    repoId: z.string().min(1).default("tokenpilot")
  })
  .default({
    repoId: "tokenpilot"
  });

const fileReadSchema = z.object({
  repoId: z.string().min(1),
  path: z.string().min(1)
});

const fileReadBatchSchema = z.object({
  repoId: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1).max(10)
});

function normalizePackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };

  if (typeof record.repoRoot === "string" && typeof record.repoId !== "string") {
    record.repoId = "tokenpilot";
  }

  delete record.repoRoot;
  return record;
}

function projectPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = normalizePackLikeObject(value) as Record<string, unknown>;
  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.repoId === "string" ? { repoId: record.repoId } : {}),
    ...(typeof record.repoName === "string" ? { repoName: record.repoName } : {}),
    ...(typeof record.repomixXmlPath === "string"
      ? { repomixXmlPath: record.repomixXmlPath }
      : {}),
    ...(typeof record.promptPath === "string" ? { promptPath: record.promptPath } : {}),
    ...(typeof record.summaryPath === "string" ? { summaryPath: record.summaryPath } : {}),
    ...(Array.isArray(record.publicIncludeEntries)
      ? { publicIncludeEntries: record.publicIncludeEntries }
      : {})
  };
}

function projectTaskPackLikeObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.markdownPath === "string"
      ? { markdownPath: record.markdownPath }
      : {}),
    ...(typeof record.jsonPath === "string" ? { jsonPath: record.jsonPath } : {})
  };
}

function toRelativeRepoPath(value: string, repoRoot: string): string {
  const repoRootPrefix = `${repoRoot}/`;
  if (value === repoRoot) {
    return "<repo>";
  }
  if (value.startsWith(repoRootPrefix)) {
    return value.slice(repoRootPrefix.length);
  }
  return value.split(repoRootPrefix).join("<repo>/").split(repoRoot).join("<repo>");
}

function sanitizeForApi(value: unknown, repoRoot: string): unknown {
  if (typeof value === "string") {
    return toRelativeRepoPath(value, repoRoot);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForApi(item, repoRoot));
  }

  if (value && typeof value === "object") {
    const normalized = normalizePackLikeObject(value) as Record<string, unknown>;
    const sanitized = Object.fromEntries(
      Object.entries(normalized).map(([key, nestedValue]) => [
        key,
        sanitizeForApi(nestedValue, repoRoot)
      ])
    );

    if (
      sanitized.type === "pack" &&
      sanitized.payload &&
      typeof sanitized.payload === "object"
    ) {
      sanitized.payload = projectPackLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "pack" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = projectPackLikeObject(sanitized.result);
    }

    if (
      sanitized.type === "taskpack" &&
      sanitized.payload &&
      typeof sanitized.payload === "object"
    ) {
      sanitized.payload = projectTaskPackLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "taskpack" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = projectTaskPackLikeObject(sanitized.result);
    }

    return sanitized;
  }

  return value;
}

function maskError(error: string | undefined, repoRoot: string): string | undefined {
  if (!error) {
    return undefined;
  }

  const firstLine = error.split("\n")[0] ?? error;
  return toRelativeRepoPath(firstLine, repoRoot);
}

function deriveJobHeadline(job: JobRecord<TokenPilotJobPayload>): string {
  if (job.type === "taskpack") {
    const title = (job.payload as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }
    return "Task pack job";
  }

  if (job.type === "pack") {
    const repoId = (job.payload as { repoId?: unknown }).repoId;
    if (typeof repoId === "string" && repoId.trim()) {
      return `Pack repo ${repoId.trim()}`;
    }
    return "Pack job";
  }

  return "TokenPilot job";
}

function projectJobPayloadForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> {
  if (job.type === "taskpack") {
    const payload = job.payload as unknown as Record<string, unknown>;
    return {
      title: typeof payload.title === "string" ? payload.title : undefined
    };
  }

  if (job.type === "pack") {
    const payload = sanitizeForApi(job.payload, repoRoot) as Record<string, unknown>;
    return {
      repoId: typeof payload.repoId === "string" ? payload.repoId : undefined
    };
  }

  return {};
}

function projectJobResultForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): Record<string, unknown> | undefined {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
    return undefined;
  }

  const result = sanitizeForApi(job.result, repoRoot) as Record<string, unknown>;

  if (job.type === "taskpack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
      markdownPath:
        typeof result.markdownPath === "string" ? result.markdownPath : undefined,
      jsonPath: typeof result.jsonPath === "string" ? result.jsonPath : undefined
    };
  }

  if (job.type === "pack") {
    return {
      createdAt: typeof result.createdAt === "string" ? result.createdAt : undefined,
      repoId: typeof result.repoId === "string" ? result.repoId : undefined,
      repoName: typeof result.repoName === "string" ? result.repoName : undefined,
      repomixXmlPath:
        typeof result.repomixXmlPath === "string" ? result.repomixXmlPath : undefined,
      promptPath: typeof result.promptPath === "string" ? result.promptPath : undefined,
      summaryPath: typeof result.summaryPath === "string" ? result.summaryPath : undefined,
      publicIncludeEntries: Array.isArray(result.publicIncludeEntries)
        ? result.publicIncludeEntries
        : undefined
    };
  }

  return undefined;
}

function projectJobForUi(
  job: JobRecord<TokenPilotJobPayload>,
  repoRoot: string
): TokenPilotPublicJobRecord {
  const projectedResult = projectJobResultForUi(job, repoRoot);
  const projectedError = maskError(job.error, repoRoot);
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    headline: deriveJobHeadline(job),
    hasResult: Boolean(job.result),
    hasError: Boolean(job.error),
    payload: projectJobPayloadForUi(job, repoRoot),
    ...(projectedResult ? { result: projectedResult } : {}),
    ...(projectedError ? { error: projectedError } : {})
  };
}

function buildHealthStatus(paths: TokenPilotPaths): TokenPilotHealthStatus {
  const publicBaseUrl = process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim() || null;
  return {
    ok: true,
    mode: "phase1-local",
    authRequired: isAuthRequired(),
    exposed: isExposedMode(),
    publicBaseUrl,
    openapiUrl: publicBaseUrl
      ? `${publicBaseUrl.replace(/\/+$/, "")}/openapi.yaml`
      : "/openapi.yaml"
  };
}

function renderUiNotBuiltPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Web UI Not Built</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f2ea;
        --panel: rgba(255, 255, 255, 0.88);
        --text: #1d2a24;
        --muted: #5d6d63;
        --line: rgba(29, 42, 36, 0.12);
        --accent: #235744;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(35, 87, 68, 0.12), transparent 34%),
          linear-gradient(135deg, #f5f2ea 0%, #ebe4d7 100%);
        color: var(--text);
        font: 15px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 24px;
      }
      main {
        width: min(720px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 22px 60px rgba(38, 54, 44, 0.12);
        backdrop-filter: blur(18px);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(35, 87, 68, 0.08);
        padding: 2px 6px;
        border-radius: 8px;
      }
      ul {
        margin: 16px 0 0;
        padding-left: 18px;
      }
      li + li {
        margin-top: 6px;
      }
      .note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TokenPilot Web UI is not built yet</h1>
      <p>The local-first read-only Web UI is served from built static assets under <code>web/dist</code>.</p>
      <p>Build the frontend first, then restart the server and open <code>/ui</code> again.</p>
      <ul>
        <li><code>npm run build:web</code></li>
        <li><code>npm run server</code></li>
        <li>Open <code>http://127.0.0.1:4318/ui</code></li>
      </ul>
      <p class="note">Current public-safe entry points remain <code>/api/health</code> and <code>/openapi.yaml</code>. Full HTTPS / Custom GPT Actions automation loop is still under validation.</p>
    </main>
  </body>
</html>`;
}

export function buildServer(paths: TokenPilotPaths) {
  validateServerAuthConfig();

  const app = Fastify({ logger: true });
  app.register(tokenPilotAuthPlugin);
  const uiDistDir = path.join(paths.repoRoot, "web", "dist");
  const hasUiDist = fs.existsSync(uiDistDir);

  if (hasUiDist) {
    app.register(fastifyStatic, {
      root: uiDistDir,
      serve: false
    });
  }

  const healthHandler = async () => {
    return buildHealthStatus(paths);
  };

  const listJobsHandler = async () => {
    return {
      ok: true,
      jobs: listJobs(paths).map((job) => projectJobForUi(job, paths.repoRoot))
    };
  };

  const getJobHandler = async (request: unknown, reply: unknown) => {
    const params = (request as { params: { id: string } }).params;
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const job = getJob(paths, params.id);
    if (!job) {
      fastifyReply.code(404);
      return { ok: false, error: "Job not found" };
    }
    return {
      ok: true,
      job: projectJobForUi(job.job, paths.repoRoot)
    };
  };

  const createPackHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const body = (request as { body?: unknown }).body ?? {};
    const parsed = packJobSchema.safeParse(body);
    if (!parsed.success) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: parsed.error.flatten()
      };
    }

    const job = createJob(paths, "pack", parsed.data);
    return {
      ok: true,
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const createTaskPackHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const parsed = taskPackSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: parsed.error.flatten()
      };
    }

    const job = createJob(paths, "taskpack", parsed.data as TaskPackInput);
    return {
      ok: true,
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const readFileHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const parsed = fileReadSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: parsed.error.flatten()
      };
    }

    try {
      return readRepoFile(paths, parsed.data);
    } catch (error) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  };

  const readFilesHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const parsed = fileReadBatchSchema.safeParse((request as { body: unknown }).body);
    if (!parsed.success) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: parsed.error.flatten()
      };
    }

    try {
      return readRepoFiles(paths, parsed.data);
    } catch (error) {
      fastifyReply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  };

  app.get("/api/health", healthHandler);
  app.get("/tokenpilot/api/health", healthHandler);

  app.get("/", async (_request, reply) => {
    reply.type("application/json; charset=utf-8");
    return {
      ok: true,
      service: "tokenpilot-control-plane",
      health: buildHealthStatus(paths),
      ui: "/ui",
      openapi: "/openapi.yaml"
    };
  });

  app.get("/favicon.ico", async (_request, reply) => {
    reply.code(204);
    return reply.send();
  });

  app.get("/api/jobs", listJobsHandler);
  app.get("/tokenpilot/api/jobs", listJobsHandler);

  app.get("/api/jobs/:id", getJobHandler);
  app.get("/tokenpilot/api/jobs/:id", getJobHandler);

  app.post("/api/jobs/pack", createPackHandler);
  app.post("/tokenpilot/api/jobs/pack", createPackHandler);

  app.post("/api/jobs/taskpack", createTaskPackHandler);
  app.post("/tokenpilot/api/jobs/taskpack", createTaskPackHandler);

  app.post("/api/files/read", readFileHandler);
  app.post("/tokenpilot/api/files/read", readFileHandler);

  app.post("/api/files/read-batch", readFilesHandler);
  app.post("/tokenpilot/api/files/read-batch", readFilesHandler);

  app.get("/openapi.yaml", async (_request, reply) => {
    reply.type("text/yaml");
    const filePath = path.join(paths.repoRoot, "openapi", "tokenpilot.openapi.yaml");
    const template = fs.readFileSync(filePath, "utf8");
    const publicBaseUrl =
      process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim() || "https://tokenpilot.example.com";

    return template.replace("https://tokenpilot.example.com", publicBaseUrl);
  });

  app.get("/ui", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      return renderUiNotBuiltPage();
    }

    return fs.readFileSync(path.join(uiDistDir, "index.html"), "utf8");
  });

  app.get("/ui/*", async (request, reply) => {
    if (!hasUiDist || !fs.existsSync(path.join(uiDistDir, "index.html"))) {
      reply.type("text/html; charset=utf-8");
      return renderUiNotBuiltPage();
    }

    const url = (request as { url: string }).url;
    const suffix = url.slice("/ui/".length);
    if (suffix.includes("..") || path.isAbsolute(suffix)) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid UI asset path"
      };
    }
    const diskPath = path.join(uiDistDir, suffix);

    if (suffix && fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      return reply.sendFile(suffix);
    }

    reply.type("text/html; charset=utf-8");
    return fs.readFileSync(path.join(uiDistDir, "index.html"), "utf8");
  });

  app.get("/privacy-policy", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TokenPilot Privacy Policy</title>
  </head>
  <body>
    <main style="max-width: 760px; margin: 40px auto; font: 16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif;">
      <h1>TokenPilot Privacy Policy</h1>
      <p>TokenPilot is a local-first automation layer for repository packaging, task-pack generation, and local runner orchestration.</p>
      <p>For this MVP, requests sent to the TokenPilot control plane may be logged locally for debugging and job traceability. Repository artifacts are generated on the local machine and remain under the local workspace unless the operator explicitly exposes the control plane or shares generated files.</p>
      <p>This MVP does not intentionally transmit repository contents to third-party services except through actions explicitly initiated by the operator, such as Custom GPT Actions calling the configured HTTPS endpoint.</p>
      <p>Operators are responsible for securing bearer tokens, public endpoints, and exposed infrastructure such as reverse proxies and tunnels.</p>
    </main>
  </body>
</html>`;
  });

  return app;
}
