import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions
} from "node:crypto";

const PASSWORD_FORMAT_VERSION = "v1";
const PASSWORD_ALGORITHM = "scrypt";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 96 * 1024 * 1024;
const SALT_LENGTH = 32;

export const OPERATOR_PASSWORD_POLICY = Object.freeze({
  minLength: 12,
  maxLength: 1024
});

const SCRYPT_OPTIONS: ScryptOptions = {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: SCRYPT_MAX_MEMORY
};

function validatePassword(password: string): void {
  if (password.length < OPERATOR_PASSWORD_POLICY.minLength) {
    throw new Error(
      `Operator password must be at least ${OPERATOR_PASSWORD_POLICY.minLength} characters`
    );
  }
  if (password.length > OPERATOR_PASSWORD_POLICY.maxLength) {
    throw new Error(
      `Operator password must be at most ${OPERATOR_PASSWORD_POLICY.maxLength} characters`
    );
  }
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

function parseEncodedPassword(encoded: string): {
  salt: Buffer;
  digest: Buffer;
} | null {
  const parts = encoded.split("$");
  if (parts.length !== 5) return null;

  const [version, algorithm, parameters, encodedSalt, encodedDigest] = parts;
  if (
    version !== PASSWORD_FORMAT_VERSION ||
    algorithm !== PASSWORD_ALGORITHM ||
    parameters !== `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}` ||
    !encodedSalt ||
    !encodedDigest ||
    !/^[A-Za-z0-9_-]+$/.test(encodedSalt) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedDigest)
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const digest = Buffer.from(encodedDigest, "base64url");
    if (salt.length !== SALT_LENGTH || digest.length !== SCRYPT_KEY_LENGTH) {
      return null;
    }
    return { salt, digest };
  } catch {
    return null;
  }
}

export async function hashOperatorPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const digest = await derivePasswordKey(password, salt);
  return [
    PASSWORD_FORMAT_VERSION,
    PASSWORD_ALGORITHM,
    `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`,
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join("$");
}

export async function verifyOperatorPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  if (
    password.length < OPERATOR_PASSWORD_POLICY.minLength ||
    password.length > OPERATOR_PASSWORD_POLICY.maxLength
  ) {
    return false;
  }

  const parsed = parseEncodedPassword(encoded);
  if (!parsed) return false;

  try {
    const actual = await derivePasswordKey(password, parsed.salt);
    return timingSafeEqual(actual, parsed.digest);
  } catch {
    return false;
  }
}
