import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase, resolveDatabasePath } from "./connection.js";

describe("openDatabase: migration failure", () => {
  it("closes the handle and propagates the error when a migration statement fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "halal-stocks-migration-fail-"));
    const dbPath = join(dir, "test.db");

    // Pre-create a VIEW named `stocks` so migration 1's `CREATE TABLE stocks`
    // fails with "view stocks already exists" instead of applying cleanly.
    // This exercises openDatabase's catch block, which must close the
    // handle (and release its WAL/journal files) before rethrowing.
    const pre = new DatabaseSync(dbPath);
    pre.exec("CREATE VIEW stocks AS SELECT 1 AS x");
    closeDatabase(pre);

    expect(() => openDatabase(dbPath)).toThrow();

    // If openDatabase had leaked the handle, this rmSync would fail with
    // EBUSY/EPERM on Windows because the file (and its -wal/-shm siblings)
    // would still be held open.
    expect(() => {
      rmSync(dir, { recursive: true, force: true });
    }).not.toThrow();
  });
});

describe("resolveDatabasePath", () => {
  const ORIGINAL_DATABASE_PATH = process.env["DATABASE_PATH"];

  afterEach(() => {
    if (ORIGINAL_DATABASE_PATH === undefined) {
      delete process.env["DATABASE_PATH"];
    } else {
      process.env["DATABASE_PATH"] = ORIGINAL_DATABASE_PATH;
    }
  });

  it("honors DATABASE_PATH when set to a non-empty value", () => {
    process.env["DATABASE_PATH"] = "/custom/path/test.db";
    expect(resolveDatabasePath()).toBe("/custom/path/test.db");
  });

  it("falls back to the default backend/data path when DATABASE_PATH is an empty string", () => {
    process.env["DATABASE_PATH"] = "";
    expect(resolveDatabasePath().endsWith(join("data", "halal-stocks.db"))).toBe(true);
  });
});
