// Council runner: round-robin debate across N agents, fail-fast.
// Members run sequentially; each sees prior outputs; last member synthesizes.

import { randomBytes } from 'node:crypto';

import type { TokenUsage } from './agent-runner.ts';
import type { DbHandle } from './db.ts';
import { logPath } from './paths.ts';
import { computeCost } from './pricing.ts';
import { providerFor } from './provider-registry.ts';
import type {
  ProviderRuntimeContext,
  ProviderRuntimeResult,
} from './provider-runtime.ts';
import {
  addComment,
  claimRun,
  finishRun,
  setRunCost,
  setRunSessionRef,
} from './repo.ts';
import { ulid } from './ulid.ts';
import { isoNow } from './time.ts';
import type { AgentProvider, CouncilRoleConfig } from './types.ts';
import { providerLabel } from './agent-config.ts';

export interface CouncilRunInput {
  parentRunId: string;
  taskId: string;
  baseOpts: ProviderRuntimeContext;
  config: CouncilRoleConfig;
  /** Build the per-member user prompt for the supplied child run_id + run_token. */
  buildMemberBasePrompt: (childRunId: string, childRunToken: string) => Promise<string>;
}

interface MemberCostSlice {
  member_index: number;
  provider: AgentProvider;
  child_run_id: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

/**
 * Run a council: N members, sequentially, each sees prior outputs.
 * Fail-fast: first member failure aborts and marks parent failed.
 *
 * Returns a synthesized ProviderRuntimeResult representing the entire council
 * run from the executor's perspective. Cost is summed; session ref / model
 * come from the synthesizer (last member).
 */
export async function executeCouncilRun(
  db: DbHandle,
  input: CouncilRunInput,
): Promise<ProviderRuntimeResult> {
  const { parentRunId, taskId, baseOpts, config, buildMemberBasePrompt } = input;
  const N = config.members.length;
  const debateOutputs: Array<{ provider: AgentProvider; summary: string }> = [];
  const breakdown: MemberCostSlice[] = [];
  let totalCost = 0;
  let aggregateUsage: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  };
  let lastResult: ProviderRuntimeResult | null = null;

  // Insert a banner so users see council has begun.
  try {
    addComment(
      db,
      taskId,
      'system',
      `[COUNCIL START] ${N}-member council for ${baseOpts.role}: ${config.members.map(providerLabel).join(' → ')}`,
    );
  } catch {
    /* best effort */
  }

  for (let i = 0; i < N; i++) {
    const memberProvider = config.members[i] as AgentProvider;
    const isSynthesizer = i === N - 1;

    // Insert child row directly. We won't go through enqueue/drain — council
    // members are not visible to the drain loop.
    const childId = ulid();
    const now = isoNow();
    db.prepare(
      `INSERT INTO agent_run(
        id, task_id, role, status, queued_at,
        session_provider_override, parent_run_id, member_index, council_size
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
    ).run(childId, taskId, baseOpts.role, now, memberProvider, parentRunId, i, N);

    // Pre-claim child row server-side and embed the matching token in the
    // member prompt — same pattern as single-agent runs in executor.ts.
    // Council members may still emit a stray abrun.claim_run call; that
    // surfaces as a harmless [mcp] claim_run FAIL log because the row is
    // already running. The token in their prompt continues to authenticate.
    const childToken = randomBytes(24).toString('hex');
    const childLog = logPath(childId);
    const claimed = claimRun(db, childId, childToken, null, childLog);
    if (!claimed) {
      const msg = `failed to claim council child ${childId}`;
      finishRun(db, childId, 'failed', null, msg);
      return abortCouncil(db, parentRunId, taskId, i, memberProvider, msg);
    }

    const memberBasePrompt = await buildMemberBasePrompt(childId, childToken);
    const augmentedPrompt = buildMemberPrompt({
      basePrompt: memberBasePrompt,
      memberIndex: i,
      total: N,
      memberProvider,
      isSynthesizer,
      priors: debateOutputs,
    });

    const memberCtx: ProviderRuntimeContext = {
      ...baseOpts,
      runId: childId,
      prompt: augmentedPrompt,
    };

    let result: ProviderRuntimeResult;
    try {
      const adapter = providerFor(memberProvider);
      result = await adapter.run(memberCtx);
    } catch (e) {
      const err = (e as Error | null)?.message ?? String(e);
      finishRun(db, childId, 'failed', null, err);
      return abortCouncil(db, parentRunId, taskId, i, memberProvider, err);
    }

    if (result.sessionRef) {
      try {
        setRunSessionRef(db, childId, {
          provider: result.sessionRef.provider,
          sessionId: result.sessionRef.sessionId,
        });
      } catch {
        /* ignore */
      }
    }

    const usage: TokenUsage = result.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    };
    const { cost_usd, cost_version } = computeCost(result.model, usage);
    const memberCost =
      result.totalCostUsd !== null && result.totalCostUsd !== undefined && result.totalCostUsd > 0
        ? result.totalCostUsd
        : cost_usd;

    try {
      setRunCost(db, childId, {
        model: result.model ?? null,
        usage,
        cost_usd: memberCost,
        cost_version: result.model ? cost_version : 0,
      });
    } catch {
      /* ignore */
    }

    breakdown.push({
      member_index: i,
      provider: memberProvider,
      child_run_id: childId,
      cost_usd: memberCost,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      cache_read_tokens: usage.cache_read_tokens,
    });
    totalCost += memberCost;
    aggregateUsage = {
      input_tokens: aggregateUsage.input_tokens + usage.input_tokens,
      output_tokens: aggregateUsage.output_tokens + usage.output_tokens,
      cache_creation_tokens:
        aggregateUsage.cache_creation_tokens + usage.cache_creation_tokens,
      cache_read_tokens: aggregateUsage.cache_read_tokens + usage.cache_read_tokens,
    };

    if (result.status !== 'completed') {
      finishRun(
        db,
        childId,
        'failed',
        null,
        result.error ?? `council member ${i + 1}/${N} (${memberProvider}) did not complete`,
      );
      return abortCouncil(
        db,
        parentRunId,
        taskId,
        i,
        memberProvider,
        result.error ?? 'member did not complete',
      );
    }

    finishRun(db, childId, 'succeeded', null, null);

    debateOutputs.push({
      provider: memberProvider,
      summary:
        `Member ${i + 1}/${N} (${providerLabel(memberProvider)}) completed. ` +
        `See task comments for full output.`,
    });
    lastResult = result;
  }

  // Stamp aggregate breakdown onto parent.
  try {
    db.prepare(`UPDATE agent_run SET cost_breakdown_json=?, council_size=? WHERE id=?`).run(
      JSON.stringify(breakdown),
      N,
      parentRunId,
    );
  } catch {
    /* ignore */
  }

  // Synthesize result for parent: last member's session/model, summed cost+usage.
  const synth: ProviderRuntimeResult = {
    status: 'completed',
    sessionRef: lastResult?.sessionRef ?? null,
    usage: aggregateUsage,
    model: lastResult?.model ?? null,
    totalCostUsd: totalCost,
  };
  try {
    const synthesizer = config.members[N - 1] as AgentProvider;
    addComment(
      db,
      taskId,
      'system',
      `[COUNCIL DONE] ${N}-member council finished. Synthesizer: ${providerLabel(synthesizer)}.`,
    );
  } catch {
    /* ignore */
  }
  return synth;
}

function abortCouncil(
  db: DbHandle,
  parentRunId: string,
  taskId: string,
  memberIndex: number,
  provider: AgentProvider,
  reason: string,
): ProviderRuntimeResult {
  try {
    addComment(
      db,
      taskId,
      'system',
      `COUNCIL_FAILED: member ${memberIndex + 1} (${providerLabel(provider)}): ${reason}`,
    );
  } catch {
    /* ignore */
  }
  return {
    status: 'failed',
    error: `council member ${memberIndex + 1} (${provider}) failed: ${reason}`,
    errorKind: 'error',
  };
  // Note: parent row's finishRun is invoked by the executor's outer flow,
  // so we don't touch it here.
}

interface BuildMemberPromptArgs {
  basePrompt: string;
  memberIndex: number;
  total: number;
  memberProvider: AgentProvider;
  isSynthesizer: boolean;
  priors: Array<{ provider: AgentProvider; summary: string }>;
}

function buildMemberPrompt(args: BuildMemberPromptArgs): string {
  const { basePrompt, memberIndex, total, memberProvider, isSynthesizer, priors } = args;
  const header =
    `\n\n## Council Mode — Member ${memberIndex + 1} of ${total}\n\n` +
    `You are participating in a multi-agent council on this task. ` +
    `Provider: **${providerLabel(memberProvider)}**.\n\n` +
    (isSynthesizer
      ? `You are the **synthesizer** (final member). Read the prior debate, then produce the canonical role artifacts (DEV_COMPLETED / REVIEW_VERDICT / ENRICHMENT_SUMMARY etc.) for this run. Your output is the council's official output. Prefix any debate-style commentary with \`[COUNCIL FINAL]\`.`
      : `You are an intermediate council member. Contribute your perspective, then stop. Do not call \`finish_run\` — only the synthesizer finishes the council. Prefix every comment you add with \`[COUNCIL ${memberIndex + 1}/${total} ${providerLabel(memberProvider)}]\`.`);

  let priorsBlock = '';
  if (priors.length > 0) {
    priorsBlock =
      `\n\n## Prior Council Debate\n\n` +
      priors
        .map(
          (p, idx) =>
            `### Member ${idx + 1}/${total} — ${providerLabel(p.provider)}\n${p.summary}`,
        )
        .join('\n\n') +
      `\n\nFull comments from prior members are visible in the task comment history; read them for full context.`;
  }

  return basePrompt + header + priorsBlock;
}
