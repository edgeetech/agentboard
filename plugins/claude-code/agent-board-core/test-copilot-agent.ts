#!/usr/bin/env node

import { CopilotClient, approveAll } from '@github/copilot-sdk';

const client = new CopilotClient({
  autoStart: true,
  useStdio: true,
});

async function test(): Promise<void> {
  try {
    await client.start();
    const session = await client.createSession({
      onPermissionRequest: approveAll,
    });

    console.log('[TEST] Checking for agent-related methods...');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(session) as object);
    for (const m of methods) {
      if (
        m.includes('agent') ||
        m.includes('run') ||
        m.includes('execute') ||
        m.includes('turn') ||
        m.includes('message')
      ) {
        console.log(`  ✓ ${m}`);
      }
    }

    // Check for agent property
    const sessionAny = session as Record<string, unknown>;
    if (sessionAny['agent']) {
      console.log('\n[TEST] session.agent exists!');
      console.log('  agent type:', typeof sessionAny['agent']);
      const agentMethods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(sessionAny['agent'] as object) as object,
      );
      for (const m of agentMethods) console.log(`    - ${m}`);
    }

    // Try looking for createAgent
    const clientAny = client as Record<string, unknown>;
    if (typeof clientAny['createAgent'] === 'function') {
      console.log('\n[TEST] client.createAgent exists!');
      const agent = await (
        clientAny['createAgent'] as (opts: { role: string }) => Promise<unknown>
      )({ role: 'pm' });
      console.log('  agent created:', agent);
    }

    await session.disconnect();
    client.stop();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[TEST] Error:', error.message);
  }
}

void test();
