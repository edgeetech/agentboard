import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteFileBackup, restoreSqliteFileBackup } from "../src/index.ts";

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot !== null) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function tempPath(name: string): string {
  if (tempRoot === null) tempRoot = mkdtempSync(join(tmpdir(), "agentboard-backup-"));
  return join(tempRoot, name);
}

describe("SQLite backup helpers", () => {
  it("copies the main database and WAL sidecars into a timestamped backup", () => {
    const source = tempPath("project.db");
    writeFileSync(source, "main", "utf8");
    writeFileSync(`${source}-wal`, "wal", "utf8");
    writeFileSync(`${source}-shm`, "shm", "utf8");

    const backup = createSqliteFileBackup({
      sourcePath: source,
      backupDir: tempPath("backups"),
      now: () => new Date("2026-08-24T12:34:56.789Z"),
    });

    expect(backup.createdAt).toBe("2026-08-24T12:34:56.789Z");
    expect(backup.backupPath.endsWith("project.db.2026-08-24T12-34-56-789Z.bak")).toBe(true);
    expect(backup.copiedPaths).toEqual([
      backup.backupPath,
      `${backup.backupPath}-wal`,
      `${backup.backupPath}-shm`,
    ]);
    expect(readFileSync(backup.backupPath, "utf8")).toBe("main");
    expect(readFileSync(`${backup.backupPath}-wal`, "utf8")).toBe("wal");
    expect(readFileSync(`${backup.backupPath}-shm`, "utf8")).toBe("shm");
  });

  it("restores a backup without overwriting existing targets by default", () => {
    const backup = tempPath("project.db.bak");
    const target = tempPath("project.db");
    writeFileSync(backup, "backup", "utf8");
    writeFileSync(target, "current", "utf8");

    expect(() => restoreSqliteFileBackup({ backupPath: backup, targetPath: target })).toThrow(
      /Refusing to overwrite/,
    );

    expect(readFileSync(target, "utf8")).toBe("current");
    expect(restoreSqliteFileBackup({ backupPath: backup, targetPath: target, overwrite: true }))
      .toEqual([target]);
    expect(readFileSync(target, "utf8")).toBe("backup");
  });
});
