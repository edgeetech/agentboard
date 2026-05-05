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

    console.log('[TEST] Session methods:');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(session) as object);
    for (const m of methods) console.log('  -', m);

    // Try to find send or execute method
    console.log('\n[TEST] Looking for execution methods...');
    const sessionAny = session as Record<string, unknown>;
    if (typeof sessionAny['sendAndWait'] === 'function')
      console.log('  ✓ session.sendAndWait exists');
    if (typeof sessionAny['executeMessage'] === 'function')
      console.log('  ✓ session.executeMessage exists');
    if (typeof sessionAny['execute'] === 'function') console.log('  ✓ session.execute exists');
    if (typeof sessionAny['sendMessage'] === 'function')
      console.log('  ✓ session.sendMessage exists');

    // Check CopilotClient methods too
    console.log('\n[TEST] CopilotClient methods:');
    const clientMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(client) as object);
    for (const m of clientMethods) {
      if (m.includes('send') || m.includes('execute') || m.includes('run') || m.includes('agent')) {
        console.log('  -', m);
      }
    }

    // Check if agent exists
    console.log('\n[TEST] Checking for agent property...');
    console.log('  session.agent:', typeof sessionAny['agent']);
    if (sessionAny['agent']) {
      console.log(
        '  agent methods:',
        Object.getOwnPropertyNames(Object.getPrototypeOf(sessionAny['agent'] as object) as object),
      );
    }

    await session.disconnect();
    client.stop();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[TEST] Error:', error.message);
  }
}

void test();
