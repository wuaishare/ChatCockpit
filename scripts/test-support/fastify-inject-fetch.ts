import type { FastifyInstance } from "fastify";

function bodyText(body: BodyInit | null | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  throw new Error(`Unsupported in-memory fixture request body: ${body.constructor?.name ?? typeof body}`);
}

export function fastifyInjectFetch(app: FastifyInstance): typeof fetch {
  return async (input, init = {}) => {
    if (init.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const requestUrl = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    const payload = bodyText(init.body);
    const injected = await app.inject({
      method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD",
      url: `${requestUrl.pathname}${requestUrl.search}`,
      headers: Object.fromEntries(headers.entries()),
      ...(payload === undefined ? {} : { payload })
    });

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(injected.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const entry of value) responseHeaders.append(key, String(entry));
      } else {
        responseHeaders.set(key, String(value));
      }
    }

    return new Response(injected.body, {
      status: injected.statusCode,
      headers: responseHeaders
    });
  };
}
