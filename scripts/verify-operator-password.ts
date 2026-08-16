import assert from "node:assert/strict";

import {
  hashOperatorPassword,
  verifyOperatorPassword
} from "../src/auth/operator-password.js";

async function main(): Promise<void> {
  const password = "test-password-correct-horse-battery-staple";
  const encoded = await hashOperatorPassword(password);

  assert.match(
    encoded,
    /^v1\$scrypt\$N=32768,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/
  );
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyOperatorPassword(password, encoded), true);
  assert.equal(await verifyOperatorPassword("wrong password", encoded), false);
  assert.equal(await verifyOperatorPassword(password, "malformed"), false);
  assert.equal(
    await verifyOperatorPassword(
      password,
      encoded.replace("N=32768", "N=1048576")
    ),
    false
  );

  await assert.rejects(
    () => hashOperatorPassword("too short"),
    /at least 12 characters/
  );
  await assert.rejects(
    () => hashOperatorPassword("x".repeat(1025)),
    /at most 1024 characters/
  );

  process.stdout.write("OPERATOR_PASSWORD_OK\n");
}

await main();
