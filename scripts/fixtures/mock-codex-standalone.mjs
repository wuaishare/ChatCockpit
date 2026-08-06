import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = path.resolve(process.env.TOKENPILOT_MOCK_STANDALONE_ROOT || process.cwd());
const tracePath = process.env.TOKENPILOT_MOCK_STANDALONE_TRACE;
const unsupportedMethod = process.env.TOKENPILOT_MOCK_UNSUPPORTED_METHOD || "";

function trace(message) {
  if (!tracePath) return;
  fs.appendFileSync(tracePath, `${JSON.stringify(message)}\n`, "utf8");
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
}

function safePath(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("path is required");
  }
  const resolved = path.resolve(value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("path is outside the standalone fixture root");
  }
  return resolved;
}

function readDirectoryEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    fileName: entry.name,
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile()
  }));
}

function fuzzyFiles(query, roots) {
  const normalizedQuery = String(query || "").toLowerCase();
  const results = [];
  for (const rootValue of roots || []) {
    const searchRoot = safePath(rootValue);
    const stack = [searchRoot];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolute);
        }
        if (!entry.name.toLowerCase().includes(normalizedQuery)) {
          continue;
        }
        results.push({
          root: searchRoot,
          path: path.relative(searchRoot, absolute).replaceAll(path.sep, "/"),
          match_type: entry.isDirectory() ? "directory" : "file",
          file_name: entry.name,
          score: 1,
          indices: null
        });
      }
    }
  }
  return results;
}

const lineReader = readline.createInterface({ input: process.stdin });
lineReader.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  trace(message);
  if (message.id === undefined || typeof message.method !== "string") {
    return;
  }
  if (message.method === unsupportedMethod) {
    fail(message.id, -32601, `unsupported fixture method ${message.method}`);
    return;
  }

  try {
    switch (message.method) {
      case "initialize":
        respond(message.id, {
          protocolVersion: "2.0",
          capabilities: {
            filesystem: true,
            commandExec: true,
            fuzzyFileSearch: true
          },
          serverInfo: {
            name: "tokenpilot-mock-standalone",
            version: "1.0.0"
          }
        });
        break;
      case "fs/getMetadata": {
        const target = safePath(message.params?.path);
        const stats = fs.lstatSync(target);
        respond(message.id, {
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: stats.isSymbolicLink(),
          createdAtMs: stats.birthtimeMs || 0,
          modifiedAtMs: stats.mtimeMs || 0
        });
        break;
      }
      case "fs/readDirectory": {
        const target = safePath(message.params?.path);
        respond(message.id, { entries: readDirectoryEntries(target) });
        break;
      }
      case "fs/readFile": {
        const target = safePath(message.params?.path);
        respond(message.id, {
          dataBase64: fs.readFileSync(target).toString("base64")
        });
        break;
      }
      case "fs/writeFile": {
        const target = safePath(message.params?.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(
          target,
          Buffer.from(String(message.params?.dataBase64 || ""), "base64")
        );
        respond(message.id, {});
        break;
      }
      case "fs/createDirectory": {
        const target = safePath(message.params?.path);
        fs.mkdirSync(target, { recursive: message.params?.recursive !== false });
        respond(message.id, {});
        break;
      }
      case "fs/copy": {
        const source = safePath(message.params?.sourcePath);
        const destination = safePath(message.params?.destinationPath);
        fs.cpSync(source, destination, {
          recursive: message.params?.recursive === true
        });
        respond(message.id, {});
        break;
      }
      case "fs/remove": {
        const target = safePath(message.params?.path);
        fs.rmSync(target, {
          recursive: message.params?.recursive !== false,
          force: message.params?.force !== false
        });
        respond(message.id, {});
        break;
      }
      case "fuzzyFileSearch":
        respond(message.id, {
          files: fuzzyFiles(message.params?.query, message.params?.roots)
        });
        break;
      case "command/exec": {
        const command = Array.isArray(message.params?.command)
          ? message.params.command.map(String)
          : [];
        if (!command.length) {
          fail(message.id, -32602, "command is required");
          break;
        }
        const cwd = safePath(message.params?.cwd || root);
        const result = spawnSync(command[0], command.slice(1), {
          cwd,
          encoding: "utf8",
          timeout:
            typeof message.params?.timeoutMs === "number"
              ? message.params.timeoutMs
              : 5_000,
          maxBuffer:
            typeof message.params?.outputBytesCap === "number"
              ? Math.max(message.params.outputBytesCap * 2, 8_192)
              : 64 * 1_024
        });
        respond(message.id, {
          exitCode: result.status ?? (result.error ? 1 : 0),
          stdout: result.stdout || "",
          stderr: result.stderr || result.error?.message || ""
        });
        break;
      }
      default:
        fail(message.id, -32601, `unknown fixture method ${message.method}`);
    }
  } catch (error) {
    fail(
      message.id,
      -32602,
      error instanceof Error ? error.message : String(error)
    );
  }
});
