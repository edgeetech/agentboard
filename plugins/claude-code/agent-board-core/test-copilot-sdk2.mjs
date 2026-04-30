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

    console.log('[TEST] Session methods:');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(session));
    methods.forEach(m => console.log('  -', m));

    // Try to find send or execute method
    console.log('\n[TEST] Looking for execution methods...');
    if (typeof session.sendAndWait === 'function') console.log('  ✓ session.sendAndWait exists');
    if (typeof session.executeMessage === 'function') console.log('  ✓ session.executeMessage exists');
    if (typeof session.execute === 'function') console.log('  ✓ session.execute exists');
    if (typeof session.sendMessage === 'function') console.log('  ✓ session.sendMessage exists');

    // Check CopilotClient methods too
    console.log('\n[TEST] CopilotClient methods:');
    const clientMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    clientMethods.forEach(m => {
      if (m.includes('send') || m.includes('execute') || m.includes('run') || m.includes('agent')) {
        console.log('  -', m);
      }
    });

    // Check if agent exists
    console.log('\n[TEST] Checking for agent property...');
    console.log('  session.agent:', typeof session.agent);
    if (session.agent) {
      console.log('  agent methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(session.agent)));
    }

    await session.disconnect();
    client.stop();
  } catch (err) {
    console.error('[TEST] Error:', err.message);
  }
}

test();
