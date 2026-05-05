import { CopilotClient, approveAll } from '@github/copilot-sdk';

console.log('=== Testing Copilot SDK Directly ===');
console.log('Checking environment variables...');
console.log('GITHUB_TOKEN:', process.env.GITHUB_TOKEN ? 'SET' : 'NOT SET');
console.log('COPILOT_TOKEN:', process.env.COPILOT_TOKEN ? 'SET' : 'NOT SET');
console.log('');

try {
  console.log('Creating CopilotClient...');
  const client = new CopilotClient({
    autoStart: true,
    useStdio: true,
    logLevel: 'debug',
  });

  console.log('Starting client...');
  await client.start();
  console.log('✓ Client started successfully');

  console.log('\nCreating session...');
  const session = await client.createSession({
    onPermissionRequest: approveAll,
    systemMessage: { systemPrompt: 'You are a helpful assistant.' },
  });
  console.log('✓ Session created:', session.sessionId);

  console.log('\nSetting up listeners...');
  let messageCount = 0;
  session.on('assistant.message', (event) => {
    messageCount++;
    console.log(`  [Message ${messageCount}]`, event.data?.content ? 'received' : 'event');
  });

  session.on('session.idle', () => {
    console.log('✓ session.idle event received');
  });

  session.on('error', (event) => {
    console.error('✗ Session error:', event.data);
  });

  console.log('\nSending test prompt...');
  await session.send({ prompt: 'Hello! Say "test successful"' });
  console.log('✓ Prompt sent');

  // Wait for idle event
  console.log('\nWaiting for session.idle...');
  await new Promise<void>((resolve) => {
    const handler = () => {
      session.removeListener('session.idle', handler);
      console.log('✓ Idle event handled, resolving');
      resolve();
    };
    session.on('session.idle', handler);

    setTimeout(() => {
      console.error('✗ Timeout waiting for idle');
      resolve();
    }, 30_000);
  });

  console.log('\nDisconnecting...');
  await session.disconnect();
  console.log('✓ Session disconnected');
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error('✗ Error:', error.message);
  console.error(error.stack);
}
