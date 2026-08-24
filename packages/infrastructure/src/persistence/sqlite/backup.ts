import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface SqliteBackupManifest {
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly copiedPaths: readonly string[];
  readonly createdAt: string;
}

export interface CreateSqliteBackupOptions {
  readonly sourcePath: string;
  readonly backupDir: string;
  readonly now?: () => Date;
}

export interface RestoreSqliteBackupOptions {
  readonly backupPath: string;
  readonly targetPath: string;
  readonly overwrite?: boolean;
}

export function createSqliteFileBackup(options: CreateSqliteBackupOptions): SqliteBackupManifest {
  if (!existsSync(options.sourcePath)) {
    throw new Error(`SQLite backup source does not exist: ${options.sourcePath}`);
  }

  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const backupPath = join(options.backupDir, `${basename(options.sourcePath)}.${stamp}.bak`);
  const copiedPaths = copySqliteFiles(options.sourcePath, backupPath, false);

  return {
    sourcePath: options.sourcePath,
    backupPath,
    copiedPaths,
    createdAt,
  };
}

export function restoreSqliteFileBackup(options: RestoreSqliteBackupOptions): readonly string[] {
  if (!existsSync(options.backupPath)) {
    throw new Error(`SQLite backup does not exist: ${options.backupPath}`);
  }
  return copySqliteFiles(options.backupPath, options.targetPath, options.overwrite === true);
}

function copySqliteFiles(sourcePath: string, targetPath: string, overwrite: boolean): string[] {
  const copiedPaths: string[] = [];
  mkdirSync(dirname(targetPath), { recursive: true });
  copySingleFile(sourcePath, targetPath, overwrite);
  copiedPaths.push(targetPath);

  for (const suffix of ["-wal", "-shm"]) {
    const sourceSidecar = `${sourcePath}${suffix}`;
    if (!existsSync(sourceSidecar)) continue;
    const targetSidecar = `${targetPath}${suffix}`;
    copySingleFile(sourceSidecar, targetSidecar, overwrite);
    copiedPaths.push(targetSidecar);
  }

  return copiedPaths;
}

function copySingleFile(sourcePath: string, targetPath: string, overwrite: boolean): void {
  if (!overwrite && existsSync(targetPath)) {
    throw new Error(`Refusing to overwrite existing SQLite backup target: ${targetPath}`);
  }
  copyFileSync(sourcePath, targetPath);
}
