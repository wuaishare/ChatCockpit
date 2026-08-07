export interface WaitForOptions {
  label: string;
  timeoutMs?: number;
  intervalMs?: number;
  retryOnError?: boolean;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForValue<T>(
  read: () => T | null | undefined | Promise<T | null | undefined>,
  options: WaitForOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) return value;
      lastError = undefined;
    } catch (error) {
      if (options.retryOnError === false) throw error;
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix =
    lastError instanceof Error
      ? ` Last error: ${lastError.message}`
      : lastError !== undefined
        ? ` Last error: ${String(lastError)}`
        : "";
  throw new Error(`Timed out waiting for ${options.label}.${suffix}`);
}

export async function waitForHttpReady(
  url: string,
  options: Omit<WaitForOptions, "label"> & { label?: string } = {}
): Promise<void> {
  await waitForValue(
    async () => {
      const response = await fetch(url);
      return response.ok ? true : null;
    },
    {
      label: options.label ?? url,
      timeoutMs: options.timeoutMs ?? 10_000,
      intervalMs: options.intervalMs ?? 75
    }
  );
}

export async function waitForTextMatch(
  read: () => string,
  pattern: RegExp,
  options: Omit<WaitForOptions, "label"> & { label?: string } = {}
): Promise<void> {
  await waitForValue(
    () => {
      pattern.lastIndex = 0;
      return pattern.test(read()) ? true : null;
    },
    {
      label: options.label ?? `output matching ${pattern}`,
      timeoutMs: options.timeoutMs ?? 8_000,
      intervalMs: options.intervalMs ?? 50
    }
  );
}
