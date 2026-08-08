import fs from "node:fs";
import readline from "node:readline";

const mode = process.argv[2] ?? "normal";
if (mode === "ignore-sigterm") {
  process.on("SIGTERM", () => {});
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const tools = [
  {
    name: "read_file",
    description: "Read a file fixture",
    inputSchema: { type: "object", properties: { path: { type: "string" } } }
  },
  {
    name: "write_file",
    description: "Write a file fixture",
    inputSchema: { type: "object", properties: { path: { type: "string" } } }
  },
  {
    name: "edit_block",
    description: "Edit a file fixture",
    inputSchema: { type: "object", properties: { path: { type: "string" } } }
  },
  {
    name: "execute_command",
    description: "Execute a command fixture",
    inputSchema: { type: "object", properties: { command: { type: "string" } } }
  },
  {
    name: "unmapped_private_tool",
    description: "Must never be inferred into TokenPilot capabilities",
    inputSchema: { type: "object" }
  }
];

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === "initialize" && typeof message.id === "number") {
    if (mode === "exit") {
      process.exit(23);
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fake-downstream", version: "1.0.0" }
      }
    });
    return;
  }

  if (message.method === "tools/list" && typeof message.id === "number") {
    if (mode === "timeout") {
      return;
    }
    if (mode === "invalid-protocol") {
      process.stdout.write('{"not":"json-rpc"}\n');
      return;
    }
    if (mode === "invalid-list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: [{ name: 42 }] }
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools }
    });
    return;
  }

  if (message.method === "tools/call" && typeof message.id === "number") {
    const toolName = message.params?.name ?? "unknown";
    if (mode === "desktop-read" && toolName === "read_file") {
      const target = message.params?.arguments?.path;
      if (typeof target !== "string") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "missing path" }],
            isError: true
          }
        });
        return;
      }
      try {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: fs.readFileSync(target, "utf8") }],
            isError: false
          }
        });
      } catch {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "read failed" }],
            isError: true
          }
        });
      }
      return;
    }
    if (mode === "desktop-mutation" && toolName === "write_file") {
      const target = message.params?.arguments?.path;
      const content = message.params?.arguments?.content;
      const writeMode = message.params?.arguments?.mode ?? "rewrite";
      if (
        typeof target !== "string" ||
        typeof content !== "string" ||
        writeMode !== "rewrite"
      ) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "invalid write args" }],
            isError: true
          }
        });
        return;
      }
      try {
        fs.writeFileSync(target, content, "utf8");
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "write ok" }],
            isError: false
          }
        });
      } catch {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "write failed" }],
            isError: true
          }
        });
      }
      return;
    }
    if (mode === "desktop-mutation" && toolName === "edit_block") {
      const target = message.params?.arguments?.file_path;
      const oldText = message.params?.arguments?.old_string;
      const newText = message.params?.arguments?.new_string;
      const expected = message.params?.arguments?.expected_replacements ?? 1;
      if (
        typeof target !== "string" ||
        typeof oldText !== "string" ||
        typeof newText !== "string" ||
        expected !== 1
      ) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "invalid edit args" }],
            isError: true
          }
        });
        return;
      }
      try {
        const current = fs.readFileSync(target, "utf8");
        const count = current.split(oldText).length - 1;
        if (count !== 1) {
          throw new Error("exact edit mismatch");
        }
        fs.writeFileSync(target, current.replace(oldText, newText), "utf8");
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "edit ok" }],
            isError: false
          }
        });
      } catch {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "edit failed" }],
            isError: true
          }
        });
      }
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: `called:${toolName}`
          }
        ],
        isError: false
      }
    });
  }
});
