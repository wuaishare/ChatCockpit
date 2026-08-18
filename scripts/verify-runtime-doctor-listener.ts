import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(import.meta.dirname, "doctor-local-runtime.sh"),
  "utf8"
);

assert.match(source, /command -v lsof[^\n]*&& lsof -nP -iTCP:/);
assert.match(source, /command -v nc[^\n]*&& nc -z -w 1/);
assert.match(source, /TCP listener is reachable on \$\{HOST\}:\$\{PORT\}; process attribution is unavailable/);
assert.match(source, /No reachable TCP listener on \$\{HOST\}:\$\{PORT\}/);
assert.doesNotMatch(source, /No process is listening on \$\{HOST\}:\$\{PORT\}/);

process.stdout.write("VERIFY_RUNTIME_DOCTOR_LISTENER_OK\n");
