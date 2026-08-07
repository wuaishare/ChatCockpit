import type { FastifyInstance } from "fastify";

export interface TestServerHandle {
  app: FastifyInstance;
  baseUrl: string;
  close(): Promise<void>;
}

export async function listenTestServer(app: FastifyInstance): Promise<TestServerHandle> {
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  let closed = false;
  return {
    app,
    baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
    }
  };
}
