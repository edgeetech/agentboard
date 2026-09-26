// Worker-thread entry for the session index. Reads session DB files off the
// main event loop and streams one result message per file back to the parent.

import { parentPort } from 'node:worker_threads';

import { scanSessionFile, type SessionScanRequest } from './session-index.ts';
import { getReadOpener } from './session-store.ts';

const port = parentPort;
if (port) {
  port.on('message', (msg: SessionScanRequest) => {
    void (async (): Promise<void> => {
      const open = await getReadOpener();
      for (const file of msg.files) {
        port.postMessage({ kind: 'file', result: scanSessionFile(open, file) });
      }
      port.postMessage({ kind: 'done' });
    })();
  });
}
