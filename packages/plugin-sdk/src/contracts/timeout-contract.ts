/**
 * Timeout Detection Contract
 *
 * All provider plugins must ensure error messages match this pattern
 * so that the orchestration layer can reliably detect timeout errors
 * and apply appropriate retry policies.
 *
 * Plugin implementers: If your provider SDK throws timeout errors,
 * ensure the error message contains one of the keywords below.
 * Do not rely on error types alone, as they may not be normalized.
 */

export const TIMEOUT_MESSAGE_PATTERN = /timeout|timed.?out|execution.?limit|time.?limit|deadline/i;

export const TIMEOUT_MESSAGE_EXAMPLES = [
  'Execution timed out after 30s',
  'Request timeout',
  'Time limit exceeded',
  'Timed out waiting for response',
  'Execution deadline exceeded',
  'Operation exceeded time limit',
];

/**
 * Detect if an error message indicates a timeout condition.
 *
 * @param message - Error message from provider or plugin
 * @returns true if message matches timeout pattern, false otherwise
 *
 * @example
 * ```ts
 * try {
 *   await runtime.execute(request);
 * } catch (error) {
 *   if (isTimeoutError(error.message)) {
 *     // Apply retry policy
 *   }
 * }
 * ```
 */
export function isTimeoutError(message: string): boolean {
  if (!message || typeof message !== 'string') {
    return false;
  }
  return TIMEOUT_MESSAGE_PATTERN.test(message);
}

/**
 * Documentation for plugin authors:
 *
 * When your provider SDK throws or reports an error condition:
 * 1. Check if the root cause is a timeout
 * 2. If yes, ensure error.message includes a timeout keyword
 * 3. Do not mask or obscure timeout errors as generic failures
 *
 * Example plugin implementation:
 * ```ts
 * try {
 *   return await providerSDK.execute(request);
 * } catch (error) {
 *   if (error.code === 'TIMEOUT' || error.name === 'TimeoutError') {
 *     throw new Error(`Execution timed out: ${error.message}`);
 *   }
 *   throw error;
 * }
 * ```
 */
