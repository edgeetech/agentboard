import type { AgentRunnerOptions } from '../../../../providers/claude/src/runner.ts';
import type { RunResult } from '../provider-types.ts';

export class AgentRunner {
  constructor(options: AgentRunnerOptions);
  run(): Promise<RunResult>;
}
