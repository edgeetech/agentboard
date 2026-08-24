import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createClaudeProviderAdapter } from '../../../providers/claude/src/index.ts';
import { createCodexProviderAdapter } from '../../../providers/codex/src/index.ts';
import { createCopilotProviderAdapter } from '../../../providers/copilot/src/index.ts';

import { AgentRunner } from './agent-runner.ts';
import { CodexRunner } from './codex-runner.ts';
import { CopilotRunner } from './copilot-runner.ts';
import { buildResumeCommand } from './provider-runtime.ts';
import type { ProviderRuntimeAdapter, ProviderRuntimeContext } from './provider-runtime.ts';
import type { AgentProvider } from './types.ts';

const claudeProvider = createClaudeProviderAdapter<ProviderRuntimeContext>({
  Runner: AgentRunner,
  buildResumeCommand,
}) satisfies ProviderRuntimeAdapter;
const copilotProvider = createCopilotProviderAdapter<ProviderRuntimeContext>({
  Runner: CopilotRunner,
  buildResumeCommand,
}) satisfies ProviderRuntimeAdapter;
const codexProvider = createCodexProviderAdapter<ProviderRuntimeContext>({
  Runner: CodexRunner,
  buildResumeCommand,
}) satisfies ProviderRuntimeAdapter;

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
