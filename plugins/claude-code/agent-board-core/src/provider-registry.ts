import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createCopilotProviderAdapter } from '../../../providers/copilot/src/index.ts';

import { AgentRunner } from './agent-runner.ts';
import { CodexRunner } from './codex-runner.ts';
import { CopilotRunner } from './copilot-runner.ts';
import { buildResumeCommand } from './provider-runtime.ts';
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeContext,
  ProviderRuntimeResult,
} from './provider-runtime.ts';
import type { AgentProvider } from './types.ts';

class ClaudeProviderAdapter implements ProviderRuntimeAdapter {
  readonly provider = 'claude' as const;
  readonly enforcement = {
    enforced: [
      'cwd',
      'maxTurns',
      'allowedTools',
      'mcpServerNames',
      'hooksEnabled',
      'abortSignal',
      'rateLimitBackoff',
      'approvalMode',
    ],
    intentionallyIgnored: ['filesystemSandbox'],
    notes: ['Claude runner receives cwd, maxTurns, allowedTools, hooks and abort signal.'],
  } as const;
  readonly resume = {
    interactive: true,
    command: (sessionId: string, repoPath?: string | null) =>
      buildResumeCommand(this.provider, sessionId, repoPath),
  };

  async run(ctx: ProviderRuntimeContext): Promise<ProviderRuntimeResult> {
    const runner = new AgentRunner(ctx);
    const result = await runner.run();
    return {
      ...result,
      sessionRef:
        typeof result.sessionId === 'string' && result.sessionId.length > 0
          ? { provider: this.provider, sessionId: result.sessionId }
          : null,
    };
  }
}

class CodexProviderAdapter implements ProviderRuntimeAdapter {
  readonly provider = 'codex' as const;
  readonly enforcement = {
    enforced: ['cwd', 'mcpServerNames', 'abortSignal', 'rateLimitBackoff', 'filesystemSandbox'],
    intentionallyIgnored: ['maxTurns', 'allowedTools', 'hooksEnabled', 'approvalMode'],
    notes: [
      'Codex runner launches with workspace-write sandboxing and fixed approve-for-me automation.',
      'Requested approvalMode is intentionally ignored until provider-specific approval mapping is implemented.',
    ],
  } as const;
  readonly resume = {
    interactive: true,
    command: (sessionId: string, repoPath?: string | null) =>
      buildResumeCommand(this.provider, sessionId, repoPath),
  };

  async run(ctx: ProviderRuntimeContext): Promise<ProviderRuntimeResult> {
    const runner = new CodexRunner(ctx);
    const result = await runner.run();
    return {
      ...result,
      sessionRef:
        typeof result.sessionId === 'string' && result.sessionId.length > 0
          ? { provider: this.provider, sessionId: result.sessionId }
          : null,
    };
  }
}

const claudeProvider = new ClaudeProviderAdapter();
const copilotProvider = createCopilotProviderAdapter<ProviderRuntimeContext>({
  Runner: CopilotRunner,
  buildResumeCommand,
}) satisfies ProviderRuntimeAdapter;
const codexProvider = new CodexProviderAdapter();

const PROVIDERS: Record<AgentProvider, ProviderRuntimeAdapter> = {
  claude: claudeProvider,
  github_copilot: copilotProvider,
  codex: codexProvider,
};

export function providerFor(provider: AgentProvider): ProviderRuntimeAdapter {
  return PROVIDERS[provider];
}

export function maybeRegisterInteractiveHistory(
  provider: AgentProvider,
  sessionId: string,
  projectPath: string,
  display: string,
): void {
  if (provider !== 'claude') return;
  try {
    const osPath = process.platform === 'win32' ? projectPath.replace(/\//g, '\\') : projectPath;
    const entry =
      JSON.stringify({
        display,
        pastedContents: {},
        timestamp: Date.now(),
        project: osPath,
        sessionId,
      }) + '\n';
    appendFileSync(join(homedir(), '.claude', 'history.jsonl'), entry);
  } catch (e) {
    console.warn(
      '[provider-registry] could not register with claude history:',
      (e as Error | null)?.message ?? String(e),
    );
  }
}
