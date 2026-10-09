interface BundledProjectRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly workflowType: 'WF1' | 'WF2';
  readonly repoPath: string;
  readonly maxParallel: number;
  readonly agentProvider: string;
  readonly agentConfigJson: string | null;
  readonly scanIgnoreJson: string;
  readonly concernsJson: string;
  readonly allowGit: boolean;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BundledProjectRepository {
  getCurrent(): BundledProjectRecord | undefined;
  updateCurrent(
    expectedVersion: number,
    patch: Record<string, unknown>,
  ):
    | { readonly ok: true; readonly project: BundledProjectRecord }
    | { readonly ok: false; readonly reason: string };
}

export function createSqliteProjectRepository(db: unknown): BundledProjectRepository;
