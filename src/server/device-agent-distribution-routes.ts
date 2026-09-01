import fs from "node:fs";

import type { FastifyInstance } from "fastify";

import type { DeviceAgentDistributionCatalog } from "../devices/device-agent-distribution.js";

function notFound() {
  return {
    ok: false,
    error: {
      code: "DEVICE_AGENT_DISTRIBUTION_NOT_FOUND",
      message: "Device Agent distribution is unavailable"
    }
  };
}

export function registerDeviceAgentDistributionRoutes(
  app: FastifyInstance,
  catalog: DeviceAgentDistributionCatalog
): void {
  app.get("/downloads/device-agent/manifest.json", async (_request, reply) => {
    const manifest = catalog.manifest();
    if (!manifest) {
      reply.code(404).header("cache-control", "no-store");
      return notFound();
    }
    reply
      .header("content-type", "application/json; charset=utf-8")
      .header("cache-control", "public, max-age=60")
      .header("etag", `"sha256-${manifest.sha256}"`);
    return reply.send(fs.createReadStream(manifest.path));
  });

  app.get<{
    Params: { architecture: string; fileName: string };
  }>(
    "/downloads/device-agent/macos/:architecture/:fileName",
    async (request, reply) => {
      const resolved = catalog.artifact(
        request.params.architecture,
        request.params.fileName
      );
      if (!resolved) {
        reply.code(404).header("cache-control", "no-store");
        return notFound();
      }
      reply
        .header("content-type", "application/gzip")
        .header("content-length", String(resolved.artifact.sizeBytes))
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("etag", `"sha256-${resolved.artifact.sha256}"`)
        .header(
          "content-disposition",
          `attachment; filename="${resolved.artifact.fileName}"`
        );
      return reply.send(fs.createReadStream(resolved.path));
    }
  );
}
