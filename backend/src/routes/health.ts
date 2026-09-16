import type { FastifyInstance } from "fastify";

export default async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}
