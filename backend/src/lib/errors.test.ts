import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildApp } from "../app.js";
import { AppError, handleError } from "./errors.js";

describe("error handler", () => {
  it("returns 500 INTERNAL_ERROR for unexpected errors without leaking the message", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-boom", async () => {
      throw new Error("boom");
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-boom" });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("boom");

    await app.close();
  });

  it("returns 400 VALIDATION_ERROR when a required querystring is missing", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get(
      "/throwaway-validated",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["q"],
            properties: { q: { type: "string" } },
          },
        },
      },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/throwaway-validated",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    await app.close();
  });

  it("passes through AppError statusCode/code/message", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-teapot", async () => {
      throw new AppError("TEAPOT", 418, "I am a teapot");
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-teapot" });

    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({
      error: { code: "TEAPOT", message: "I am a teapot" },
    });

    await app.close();
  });

  it("returns 400 BAD_REQUEST for malformed JSON on a route with a body schema", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.post(
      "/throwaway-json",
      { schema: { body: { type: "object" } } },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/throwaway-json",
      headers: { "content-type": "application/json" },
      payload: "{ this is not valid json",
    });

    // This exercises Fastify's own body-parser error, which reaches the
    // handler shaped like a FastifyError (code + statusCode) but with
    // `validation` unset, so it takes the generic 4xx passthrough branch
    // rather than the schema-validation branch — and the handler always
    // reports it as BAD_REQUEST, not the parser's own error code.
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "BAD_REQUEST", message: expect.any(String) as string },
    });
    expect((response.json() as { error: { message: string } }).error.message.length).toBeGreaterThan(0);

    await app.close();
  });

  it("passes through a thrown Fastify-shaped error with statusCode 429", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-rate-limited", async () => {
      // A plain object shaped like a FastifyError (code + statusCode),
      // not necessarily thrown by Fastify itself — e.g. a rate limiter.
      throw { code: "RATE_LIMITED", statusCode: 429, message: "slow down" };
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-rate-limited" });

    expect(response.statusCode).toBe(429);
    // The handler's 4xx passthrough branch always reports BAD_REQUEST as
    // the code (it does not forward the original error's own code), but
    // does forward the original message and statusCode.
    expect(response.json()).toEqual({
      error: { code: "BAD_REQUEST", message: "slow down" },
    });

    await app.close();
  });

  it("maps a Fastify-shaped error with statusCode 503 to a generic 500 without leaking its message", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-503", async () => {
      throw Object.assign(new Error("db password is hunter2"), {
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-503" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain("hunter2");
    expect(response.body).not.toContain("db password");

    await app.close();
  });

  it("maps a non-Error string throw to 500 INTERNAL_ERROR without leaking the raw value", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-raw-string", async () => {
      throw "raw-secret-string";
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-raw-string" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain("raw-secret-string");

    await app.close();
  });

  it("maps a non-Error plain-object throw to 500 INTERNAL_ERROR without leaking its contents", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get("/throwaway-raw-object", async () => {
      throw { leak: "raw-object-secret" };
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-raw-object" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain("raw-object-secret");

    await app.close();
  });

  it("logs unexpected errors via request.log.error instead of swallowing them", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    let logErrorSpy: ReturnType<typeof vi.spyOn> | undefined;
    // buildApp doesn't expose the logger, so we spy on the per-request
    // child logger from inside an onRequest hook (added here in the test,
    // not in production code) and inspect it after the request completes.
    app.addHook("onRequest", async (request) => {
      logErrorSpy = vi.spyOn(request.log, "error");
    });
    app.get("/throwaway-logged-boom", async () => {
      throw new Error("should be logged, not swallowed");
    });

    const response = await app.inject({ method: "GET", url: "/throwaway-logged-boom" });

    expect(response.statusCode).toBe(500);
    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const [firstArg, secondArg] = logErrorSpy!.mock.calls[0]!;
    expect(firstArg).toMatchObject({ err: expect.any(Error) as Error });
    expect((firstArg as { err: Error }).err.message).toBe("should be logged, not swallowed");
    expect(secondArg).toBe("unhandled error");

    await app.close();
  });

  it("does not touch the reply when it has already been sent, but still logs", () => {
    // handleError is exported for exactly this: verifying the reply.sent
    // guard without needing a real in-flight Fastify request/reply, which
    // can't easily be put into a "sent" state via app.inject().
    const fakeRequest = {
      log: { error: vi.fn() },
    } as unknown as FastifyRequest; // minimal fake; only `.log.error` is used by handleError
    const fakeReply = {
      sent: true,
      status: vi.fn(),
      send: vi.fn(),
      code: vi.fn(),
    } as unknown as FastifyReply; // minimal fake; handleError must not call any of these

    handleError(new Error("too late"), fakeRequest, fakeReply);

    expect(fakeReply.status).not.toHaveBeenCalled();
    expect(fakeReply.send).not.toHaveBeenCalled();
    expect(fakeReply.code).not.toHaveBeenCalled();
    expect(fakeRequest.log.error).toHaveBeenCalledTimes(1);
  });

  it("returns a validation error body shaped exactly as { error: { code, message } } with a non-empty message", async () => {
    const app: FastifyInstance = buildApp({ logger: false });
    app.get(
      "/throwaway-validated-shape",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["q"],
            properties: { q: { type: "string" } },
          },
        },
      },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/throwaway-validated-shape",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string } };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it.each([
    { label: "500 unhandled error", status: 500, setup: (app: FastifyInstance, path: string) => {
      app.get(path, async () => {
        throw new Error("boom");
      });
    } },
    { label: "400 validation error", status: 400, setup: (app: FastifyInstance, path: string) => {
      app.get(
        path,
        { schema: { querystring: { type: "object", required: ["q"] } } },
        async () => ({ ok: true }),
      );
    } },
    { label: "404 not found", status: 404, setup: () => {
      // no route registered; relies on the notFoundHandler
    } },
    { label: "418 AppError passthrough", status: 418, setup: (app: FastifyInstance, path: string) => {
      app.get(path, async () => {
        throw new AppError("TEAPOT", 418, "I am a teapot");
      });
    } },
  ])("error responses ($label) have JSON content-type and no extra top-level keys", async ({ status, setup }) => {
    const app: FastifyInstance = buildApp({ logger: false });
    const path = "/throwaway-shape-check";
    setup(app, path);

    const response = await app.inject({ method: "GET", url: path });

    expect(response.statusCode).toBe(status);
    expect(response.headers["content-type"]).toContain("application/json");
    const body = response.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    const errorBody = body.error as Record<string, unknown>;
    expect(Object.keys(errorBody).sort()).toEqual(["code", "message"]);

    await app.close();
  });
});
