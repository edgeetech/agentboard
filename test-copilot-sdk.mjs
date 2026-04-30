#!/usr/bin/env node

import { CopilotClient, approveAll } from '@github/copilot-sdk';

const client = new CopilotClient({
  autoStart: true,
  useStdio: true,
  logLevel: 'debug',
});

async function test() {
  try {
    console.log('[TEST] Starting Copilot SDK client...');
    await client.start();
    console.log('[TEST] Copilot SDK client started');

    console.log('[TEST] Creating session...');
    const session = await client.createSession({
      onPermissionRequest: approveAll,
    });
    console.log('[TEST] Session created:', session.sessionId);
    console.log('[TEST] Session type:', typeof session);
    console.log('[TEST] Session keys:', Object.keys(session));

    // Track events
    let idleEventFired = false;
    let assistantMessageFired = false;
    let messageEventFired = false;

    session.on('session.idle', () => {
      console.log('[TEST] [EVENT] session.idle fired');
      idleEventFired = true;
    });

    session.on('assistant.message', (event) => {
      console.log('[TEST] [EVENT] assistant.message fired:', event.data?.model || event.data);
      assistantMessageFired = true;
    });

    session.on('message', (event) => {
      console.log('[TEST] [EVENT] message fired:', event.data?.role || 'unknown');
      messageEventFired = true;
    });

    session.on('error', (event) => {
      console.log('[TEST] [EVENT] error fired:', event.data);
    });

    const prompt = 'Hello, what is 1 + 1?';
    console.log('[TEST] Sending prompt...');
    console.log('[TEST] prompt type:', typeof prompt);

    const result = await session.send({ prompt });
    console.log('[TEST] session.send() returned:', result);
    console.log('[TEST] result type:', typeof result);
    if (result) {
      console.log('[TEST] result keys:', Object.keys(result));
    }

    console.log('[TEST] After send. idleEventFired:', idleEventFired, 'assistantMessageFired:', assistantMessageFired, 'messageEventFired:', messageEventFired);

    // Wait a bit for events to fire
    console.log('[TEST] Waiting 3s for events...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('[TEST] After 3s wait. idleEventFired:', idleEventFired, 'assistantMessageFired:', assistantMessageFired, 'messageEventFired:', messageEventFired);

    console.log('[TEST] Disconnecting session...');
    await session.disconnect();
    console.log('[TEST] Session disconnected');

    console.log('[TEST] Stopping client...');
    client.stop();
    console.log('[TEST] Done');
  } catch (err) {
    console.error('[TEST] Error:', err);
  }
}

test();
