export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
}

export interface TokenRate {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

export interface EngineCostResult {
  readonly costUsd: number;
  readonly pricingVersion: number;
  readonly uncosted: boolean;
}
