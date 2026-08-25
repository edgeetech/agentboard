import type { CopilotRunnerOptions } from '../../../../providers/copilot/src/runner.ts';
import type { RunResult } from '../provider-types.ts';

export class CopilotRunner {
  constructor(options: CopilotRunnerOptions);
  run(): Promise<RunResult>;
}
