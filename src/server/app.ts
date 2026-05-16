import Fastify from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

import type { TaskPackInput, TokenPilotPaths } from "../types.js";
import { createJob, getJob, listJobs } from "../core/jobs.js";
import { tokenPilotAuthPlugin } from "./auth.js";

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

const packJobSchema = z.object({
  repoId: z.string().min(1)
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

function sanitizeForApi(value: unknown, repoRoot: string): unknown {
  if (typeof value === "string") {
    const repoRootPrefix = `${repoRoot}/`;
    if (value === repoRoot) {
      return "<repo>";
    }
    if (value.startsWith(repoRootPrefix)) {
      return value.slice(repoRootPrefix.length);
    }
    return value.split(repoRootPrefix).join("<repo>/").split(repoRoot).join("<repo>");
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
      sanitized.payload = normalizePackLikeObject(sanitized.payload);
    }

    if (
      sanitized.type === "pack" &&
      sanitized.result &&
      typeof sanitized.result === "object"
    ) {
      sanitized.result = normalizePackLikeObject(sanitized.result);
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

export function buildServer(paths: TokenPilotPaths) {
  const app = Fastify({ logger: true });
  app.register(tokenPilotAuthPlugin);

  const healthHandler = async () => {
    return {
      ok: true,
      mode: "phase1-local",
      authRequired: Boolean(process.env.TOKENPILOT_API_TOKEN?.trim())
    };
  };

  const listJobsHandler = async () => {
    return {
      ok: true,
      jobs: sanitizeForApi(listJobs(paths), paths.repoRoot)
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
      job: sanitizeForApi(job, paths.repoRoot)
    };
  };

  const createPackHandler = async (request: unknown, reply: unknown) => {
    const fastifyReply = reply as { code: (statusCode: number) => void };
    const parsed = packJobSchema.safeParse((request as { body: unknown }).body);
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

  app.get("/api/health", healthHandler);
  app.get("/tokenpilot/api/health", healthHandler);

  app.get("/api/jobs", listJobsHandler);
  app.get("/tokenpilot/api/jobs", listJobsHandler);

  app.get("/api/jobs/:id", getJobHandler);
  app.get("/tokenpilot/api/jobs/:id", getJobHandler);

  app.post("/api/jobs/pack", createPackHandler);
  app.post("/tokenpilot/api/jobs/pack", createPackHandler);

  app.post("/api/jobs/taskpack", createTaskPackHandler);
  app.post("/tokenpilot/api/jobs/taskpack", createTaskPackHandler);

  app.get("/openapi.yaml", async (_request, reply) => {
    reply.type("text/yaml");
    const filePath = path.join(paths.repoRoot, "openapi", "tokenpilot.openapi.yaml");
    const template = fs.readFileSync(filePath, "utf8");
    const publicBaseUrl =
      process.env.TOKENPILOT_PUBLIC_BASE_URL?.trim() || "https://tokenpilot.example.com";

    return template.replace("https://tokenpilot.example.com", publicBaseUrl);
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
