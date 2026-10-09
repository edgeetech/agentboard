/**
 * Redirect fd 2 to /dev/null before any native/experimental module prints
 * warnings (e.g. node:sqlite "ExperimentalWarning"). Claude Code treats ANY
 * stderr from a hook as failure. Must be imported first. Ported from
 * context-mode (https://github.com/mksglu/context-mode).
 */
import { closeSync, openSync } from "node:fs";
import { devNull } from "node:os";

// Stream-level first — Windows libuv caches the original fd 2 on the
// existing WriteStream, so reopening fd 2 alone does not silence
// process.emitWarning output. Belt-and-suspenders: replace .write AND
// redirect fd 2 so native modules that bypass the stream also stay quiet.
try { process.stderr.write = () => true; } catch {}
try {
  closeSync(2);
  openSync(devNull, "w");
} catch {}
