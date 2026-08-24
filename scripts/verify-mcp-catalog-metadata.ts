import assert from "node:assert/strict";
import { z } from "zod";

import { buildMcpToolCatalogMetadata } from "../src/mcp/catalog-metadata.ts";
import {
  defineMcpTool,
  readOnlyToolAnnotations
} from "../src/mcp/tool-definition.ts";

function fixtureTool(
  name: string,
  inputSchema: z.ZodTypeAny,
  title = name
) {
  return defineMcpTool({
    name,
    title,
    description: `Fixture ${title}`,
    inputSchema,
    annotations: readOnlyToolAnnotations,
    handler: () => ({ ok: true })
  });
}

const alpha = fixtureTool(
  "chatcockpit.fixture.alpha",
  z.object({ value: z.string() })
);
const beta = fixtureTool(
  "chatcockpit.fixture.beta",
  z.object({ count: z.number().int().min(0) })
);
const first = buildMcpToolCatalogMetadata([alpha, beta]);
const reordered = buildMcpToolCatalogMetadata([beta, alpha]);

assert.equal(first.toolCount, 2);
assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
assert.equal(first.fingerprint, reordered.fingerprint);
assert.equal(
  first.serverVersion,
  `0.1.0-alpha.${first.fingerprint.slice(0, 12)}`
);

const schemaChanged = buildMcpToolCatalogMetadata([
  fixtureTool(
    "chatcockpit.fixture.alpha",
    z.object({ value: z.string(), enabled: z.boolean().optional() })
  ),
  beta
]);
assert.notEqual(first.fingerprint, schemaChanged.fingerprint);
const transformCompatible = buildMcpToolCatalogMetadata([
  fixtureTool(
    "chatcockpit.fixture.transform",
    z.object({
      value: z.string().transform((value) => value.trim())
    })
  )
]);
assert.match(transformCompatible.fingerprint, /^[a-f0-9]{64}$/);

const descriptionChanged = buildMcpToolCatalogMetadata([
  fixtureTool(
    "chatcockpit.fixture.alpha",
    z.object({ value: z.string() }),
    "Changed title"
  ),
  beta
]);
assert.notEqual(first.fingerprint, descriptionChanged.fingerprint);

process.stdout.write("VERIFY_MCP_CATALOG_METADATA_OK\n");
