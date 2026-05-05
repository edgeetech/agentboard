import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('[test-sdk] Starting SDK test...');

try {
  console.log('[test-sdk] Calling query() with minimal options...');

  const result = await query('Say "hello"', {
    pathToClaudeCodeExecutable: 'claude',
    cwd: process.cwd(),
  });

  console.log('[test-sdk] Query succeeded!');
  console.log('[test-sdk] Result:', result);
} catch (err) {
  console.error('[test-sdk] Query failed with error:', err);
  process.exit(1);
}
