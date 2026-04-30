#!/usr/bin/env node

import { CopilotClient, approveAll } from '@github/copilot-sdk';

const client = new CopilotClient({
  autoStart: true,
  useStdio: true,
});

async function test() {
  try {
    await client.start();
    const session = await client.createSession({
      onPermissionRequest: approveAll,
    });

    console.log('[TEST] Checking for agent-related methods...');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(session));
    methods.forEach(m => {
      if (m.includes('agent') || m.includes('run') || m.includes('execute') || m.includes('turn') || m.includes('message')) {
        console.log(`  ✓ ${m}`);
      }
    });

    // Check for agent property
    if (session.agent) {
      console.log('\n[TEST] session.agent exists!');
      console.log('  agent type:', typeof session.agent);
      const agentMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(session.agent));
      agentMethods.forEach(m => console.log(`    - ${m}`));
    }

    // Try looking for createAgent
    if (typeof client.createAgent === 'function') {
      console.log('\n[TEST] client.createAgent exists!');
      const agent = await client.createAgent({ role: 'pm' });
      console.log('  agent created:', agent);
    }

    await session.disconnect();
    client.stop();
  } catch (err) {
    console.error('[TEST] Error:', err.message);
  }
}

test();
