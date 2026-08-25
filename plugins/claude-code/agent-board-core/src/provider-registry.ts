import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { AgentRunner } from './agent-runner.ts';
import { CodexRunner } from './codex-runner.ts';
import { CopilotRunner } from './copilot-runner.ts';
import { createClaudeProviderAdapter } from './generated/claude-runner.mjs';
import { createCodexProviderAdapter } from './generated/codex-provider.mjs';
import { createCopilotProviderAdapter } from './generated/copilot-runner.mjs';
import { createProviderRuntimeRegistry } from './generated/plugin-sdk-registry.mjs';
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

const providerRegistry = createProviderRuntimeRegistry([
  claudeProvider,
  copilotProvider,
  codexProvider,
]);

export function providerFor(provider: AgentProvider): ProviderRuntimeAdapter {
  return providerRegistry.require(provider);
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
