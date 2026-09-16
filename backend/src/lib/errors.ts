import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function formatError(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

function isFastifyError(error: unknown): error is FastifyError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "statusCode" in error
  );
}

// Fastify's setErrorHandler types the caught value as `unknown` (it can
// forward non-Error values thrown by handlers/plugins), so every branch
// below narrows explicitly before touching the value.
export function handleError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (reply.sent) {
    request.log.error({ err: error }, "error handler invoked after reply was already sent");
    return;
  }

  if (isFastifyError(error) && error.validation) {
    reply.status(400).send(formatError("VALIDATION_ERROR", error.message));
    return;
  }

  if (error instanceof AppError) {
    reply.status(error.statusCode).send(formatError(error.code, error.message));
    return;
  }

  if (
    isFastifyError(error) &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    reply.status(error.statusCode).send(formatError("BAD_REQUEST", error.message));
    return;
  }

  request.log.error({ err: error }, "unhandled error");
  reply.status(500).send(formatError("INTERNAL_ERROR", "Internal server error"));
}
