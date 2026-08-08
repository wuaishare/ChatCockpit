import fs from "node:fs";
import readline from "node:readline";

const mode = process.argv[2] ?? "normal";
if (mode === "ignore-sigterm") {
  process.on("SIGTERM", () => {});
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let desktopCommandCwd = null;
let desktopCommandScenario = "success";
let desktopCommandTerminated = false;
let managedProcessCwd = null;
let managedProcessTerminated = false;
let managedProcessExited = false;

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
    name: "start_process",
    description: "Start a process fixture",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number" },
        shell: { type: "string" },
        origin: { type: "string" }
      },
      required: ["command", "timeout_ms"]
    }
  },
  {
    name: "read_process_output",
    description: "Read process output fixture",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number" },
        timeout_ms: { type: "number" },
        offset: { type: "number" },
        length: { type: "number" }
      },
      required: ["pid"]
    }
  },
  {
    name: "interact_with_process",
    description: "Interact with a process fixture",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number" },
        input: { type: "string" },
        timeout_ms: { type: "number" },
        wait_for_prompt: { type: "boolean" },
        verbose_timing: { type: "boolean" }
      },
      required: ["pid", "input"]
    }
  },
  {
    name: "force_terminate",
    description: "Terminate process fixture",
    inputSchema: {
      type: "object",
      properties: { pid: { type: "number" } },
      required: ["pid"]
    }
  },
  {
    name: "execute_command",
    description: "Legacy command fixture retained to prove it is not current mapping",
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
    if (mode === "desktop-managed-process" && toolName === "start_process") {
      const command = message.params?.arguments?.command;
      const cwdMatch = typeof command === "string" ? /^cd '([^']+)' &&/.exec(command) : null;
      if (!cwdMatch) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "missing managed cwd" }],
            isError: true
          }
        });
        return;
      }
      managedProcessCwd = cwdMatch[1];
      managedProcessTerminated = false;
      managedProcessExited = false;
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: "Process started with PID 5252 (shell: /bin/zsh)\nInitial output:\nmanaged-ready"
            }
          ],
          isError: false
        }
      });
      return;
    }
    if (
      mode === "desktop-managed-process" &&
      toolName === "read_process_output"
    ) {
      let text = `${managedProcessCwd ?? "unknown"}\nmanaged-ready`;
      if (managedProcessExited) {
        text += "\n✅ Process completed with exit code 0 (runtime: 0.02s)";
      } else if (managedProcessTerminated) {
        text += "\n✅ Process completed with exit code 143 (runtime: 0.02s)";
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text }],
          isError: false
        }
      });
      return;
    }
    if (
      mode === "desktop-managed-process" &&
      toolName === "interact_with_process"
    ) {
      const input = message.params?.arguments?.input;
      if (typeof input !== "string") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "missing managed input" }],
            isError: true
          }
        });
        return;
      }
      if (input === "quit") {
        managedProcessExited = true;
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: managedProcessExited
                ? `managed-input:${input}\n✅ Process completed with exit code 0 (runtime: 0.02s)`
                : `managed-input:${input}`
            }
          ],
          isError: false
        }
      });
      return;
    }
    if (mode === "desktop-managed-process" && toolName === "force_terminate") {
      managedProcessTerminated = true;
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "terminated" }],
          isError: false
        }
      });
      return;
    }
    if (mode === "desktop-command" && toolName === "start_process") {
      const command = message.params?.arguments?.command;
      const timeoutMs = message.params?.arguments?.timeout_ms;
      const shell = message.params?.arguments?.shell;
      const origin = message.params?.arguments?.origin;
      if (
        typeof command !== "string" ||
        typeof timeoutMs !== "number" ||
        shell !== "/bin/zsh" ||
        origin !== "llm"
      ) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "invalid process args" }],
            isError: true
          }
        });
        return;
      }
      const cwdMatch = /^cd '([^']+)' &&/.exec(command);
      if (!cwdMatch) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: "missing governed cwd" }],
            isError: true
          }
        });
        return;
      }
      desktopCommandCwd = cwdMatch[1];
      desktopCommandScenario = command.includes("'host-command-slow'")
        ? "timeout"
        : command.includes("'host-command-write'")
          ? "write"
          : "success";
      desktopCommandTerminated = false;
      if (desktopCommandScenario === "write") {
        fs.mkdirSync(`${desktopCommandCwd}/src`, { recursive: true });
        fs.writeFileSync(
          `${desktopCommandCwd}/src/live.txt`,
          "TokenPilot Desktop Commander Host Command live proof\n",
          "utf8"
        );
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: "Process started with PID 4242 (shell: /bin/zsh)"
            }
          ],
          isError: false
        }
      });
      return;
    }
    if (mode === "desktop-command" && toolName === "read_process_output") {
      let text;
      if (desktopCommandScenario === "timeout" && !desktopCommandTerminated) {
        text = "Process is still running";
      } else if (desktopCommandScenario === "timeout") {
        text = "terminated fixture\n✅ Process completed with exit code 143 (runtime: 1.00s)";
      } else if (desktopCommandScenario === "write") {
        text = "workspace write fixture\n✅ Process completed with exit code 0 (runtime: 0.01s)";
      } else {
        text = `${desktopCommandCwd ?? "unknown"}\n✅ Process completed with exit code 0 (runtime: 0.01s)`;
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text }],
          isError: false
        }
      });
      return;
    }
    if (mode === "desktop-command" && toolName === "force_terminate") {
      desktopCommandTerminated = true;
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "terminated" }],
          isError: false
        }
      });
      return;
    }
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
