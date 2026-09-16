import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });

  it("returns a JSON content-type", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["content-type"]).toContain("application/json");

    await app.close();
  });

  it("responds to HEAD with a 200 and an empty body (Fastify auto-exposes HEAD for GET routes)", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "HEAD", url: "/health" });

    // Documenting actual observed behavior, not an invented contract:
    // Fastify 5 exposes a HEAD route automatically for every GET route.
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toBe("");

    await app.close();
  });

  it("does not auto-expose OPTIONS on /health — falls through to the 404 handler", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "OPTIONS", url: "/health" });

    // Documenting actual observed behavior: unlike HEAD, Fastify does not
    // auto-add an OPTIONS route, so this hits the notFoundHandler.
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route OPTIONS /health not found",
      },
    });

    await app.close();
  });
});

describe("unknown routes", () => {
  it("returns 404 NOT_FOUND", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route GET /nope not found",
      },
    });

    await app.close();
  });

  it("returns 404 NOT_FOUND for an unsupported method on a known path, mentioning the method and url", async () => {
    const app: FastifyInstance = buildApp({ logger: false });

    const response = await app.inject({ method: "POST", url: "/health" });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("POST");
    expect(body.error.message).toContain("/health");

    await app.close();
  });
});
