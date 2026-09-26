import type { SessionProvider } from './sessionsApi';

/**
 * Shell command that reopens a recorded session in its provider's CLI.
 * `;` instead of `&&` so the same string works in bash and Windows PowerShell 5.
 */
export function resumeCommand(
  sessionId: string,
  repoPath: string | null | undefined,
  provider: SessionProvider | null | undefined,
): string {
  const resume =
    provider === 'codex'
      ? `codex resume ${sessionId}`
      : provider === 'github_copilot'
        ? `copilot --resume ${sessionId}`
        : `claude --resume ${sessionId}`;
  return repoPath ? `cd "${repoPath}"; ${resume}` : resume;
}
