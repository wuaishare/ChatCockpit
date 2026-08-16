import process from "node:process";

export async function readPasswordFromStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += String(chunk);
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const password = lines.shift() ?? "";
  if (lines.some((line) => line.length > 0)) {
    throw new Error("--password-stdin accepts exactly one password line");
  }
  if (!password) {
    throw new Error("--password-stdin received an empty password");
  }
  return password;
}

export function readHiddenLine(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || !process.stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Interactive password entry requires a TTY; use --password-stdin for controlled automation");
  }

  process.stdout.write(prompt);
  stdin.setEncoding("utf8");
  const previousRawMode = Boolean(stdin.isRaw);

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(previousRawMode);
      stdin.pause();
      process.stdout.write("\n");
    };

    const finish = () => {
      cleanup();
      resolve(value);
    };

    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          fail(new Error("Password entry cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
        }
      }
    };

    stdin.on("data", onData);
    stdin.setRawMode(true);
    stdin.resume();
  });
}
