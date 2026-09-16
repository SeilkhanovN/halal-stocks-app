import { buildApp } from "./app.js";

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return 3000;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT value: "${raw}"`);
  }

  return parsed;
}

async function start(): Promise<void> {
  const app = buildApp();

  try {
    const port = resolvePort();
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
