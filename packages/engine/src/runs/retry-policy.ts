export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_MAX_RETRY_BACKOFF_MS = 300_000;

export interface RetryPolicyConfig {
  maxRetryAttempts?: number;
  maxRetryBackoffMs?: number;
}

export interface LegacyRetryPolicyConfig {
  max_retry_attempts?: number;
  max_retry_backoff_ms?: number;
}

export interface RetryDecisionInput {
  readonly attempt: number;
  readonly config?: RetryPolicyConfig;
}

export type RetryDecision =
  | {
      readonly shouldRetry: true;
      readonly delayMs: number;
      readonly nextAttempt: number;
    }
  | { readonly shouldRetry: false; readonly reason: string };

export function normalizeRetryConfig(
  config: LegacyRetryPolicyConfig = {},
): RetryPolicyConfig {
  const normalized: RetryPolicyConfig = {};
  if (config.max_retry_attempts !== undefined) {
    normalized.maxRetryAttempts = config.max_retry_attempts;
  }
  if (config.max_retry_backoff_ms !== undefined) {
    normalized.maxRetryBackoffMs = config.max_retry_backoff_ms;
  }
  return normalized;
}

export function computeBackoffMs(
  attempt: number,
  maxBackoffMs: number = DEFAULT_MAX_RETRY_BACKOFF_MS,
): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), maxBackoffMs);
}

export function decideRetry({
  attempt,
  config = {},
}: RetryDecisionInput): RetryDecision {
  const maxAttempts = config.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS;
  const maxBackoffMs = config.maxRetryBackoffMs ?? DEFAULT_MAX_RETRY_BACKOFF_MS;

  if (attempt >= maxAttempts) {
    return {
      shouldRetry: false,
      reason: `max attempts (${maxAttempts}) reached`,
    };
  }

  const nextAttempt = attempt + 1;
  const delayMs = computeBackoffMs(nextAttempt - 1, maxBackoffMs);

  return { shouldRetry: true, delayMs, nextAttempt };
}
