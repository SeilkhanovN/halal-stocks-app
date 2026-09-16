import Fastify, { type FastifyInstance } from "fastify";
import healthRoute from "./routes/health.js";
import { formatError, handleError } from "./lib/errors.js";

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const { logger = true } = opts;

  const app = Fastify({ logger });

  app.setErrorHandler(handleError);

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(
        formatError(
          "NOT_FOUND",
          `Route ${request.method} ${request.url} not found`,
        ),
      );
  });

  app.register(healthRoute);

  return app;
}
