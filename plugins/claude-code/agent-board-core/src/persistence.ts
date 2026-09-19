import type { DbHandle } from './db.ts';
import { createSqliteProjectRepository } from './generated/sqlite-persistence.mjs';
import type { ProjectPatch, ProjectRow } from './repo.ts';

interface ProjectRecordCompat {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workflowType: ProjectRow['workflow_type'];
  repoPath: string;
  maxParallel: number;
  agentProvider: ProjectRow['agent_provider'];
  agentConfigJson: string | null;
  concernsJson: string;
  allowGit: boolean;
  scanIgnoreJson: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getProjectViaPersistence(db: DbHandle): ProjectRow | undefined {
  const project = createSqliteProjectRepository(db).getCurrent() as ProjectRecordCompat | undefined;
  return project === undefined ? undefined : toLegacyProject(project);
}

export function updateProjectViaPersistence(
  db: DbHandle,
  patch: ProjectPatch,
  expectedVersion: number,
): { ok: boolean; project?: ProjectRow; reason?: string } {
  const normalized = {
    ...('name' in patch ? { name: patch.name } : {}),
    ...('description' in patch ? { description: patch.description } : {}),
    ...('repo_path' in patch ? { repoPath: patch.repo_path } : {}),
    ...('max_parallel' in patch ? { maxParallel: patch.max_parallel } : {}),
    ...('agent_provider' in patch ? { agentProvider: patch.agent_provider } : {}),
    ...('agent_config_json' in patch ? { agentConfigJson: patch.agent_config_json } : {}),
    ...('deleted_at' in patch ? { deletedAt: patch.deleted_at } : {}),
    ...('scan_ignore_json' in patch
      ? {
          scanIgnoreJson:
            typeof patch.scan_ignore_json === 'string'
              ? patch.scan_ignore_json
              : JSON.stringify(patch.scan_ignore_json),
        }
      : {}),
  };
  const result = createSqliteProjectRepository(db).updateCurrent(expectedVersion, normalized);
  if (!result.ok) return result;
  return { ok: true, project: toLegacyProject(result.project as ProjectRecordCompat) };
}

function toLegacyProject(project: ProjectRecordCompat): ProjectRow {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description,
    workflow_type: project.workflowType,
    repo_path: project.repoPath,
    max_parallel: project.maxParallel,
    agent_provider: project.agentProvider,
    agent_config_json: project.agentConfigJson,
    concerns_json: project.concernsJson,
    allow_git: project.allowGit ? 1 : 0,
    scan_ignore_json: project.scanIgnoreJson,
    version: project.version,
    deleted_at: project.deletedAt,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}
