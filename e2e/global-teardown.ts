/**
 * Playwright Global Teardown
 *
 * Ensures temporary test directories are cleaned up even if tests crash.
 * This prevents CI from accumulating test artifacts.
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function globalTeardown() {
  // Clean up temp directories from this test run
  const baseDir = tmpdir();
  try {
    // Get all agentboard-e2e-* directories
    const entries = require("node:fs").readdirSync(baseDir);
    for (const entry of entries) {
      if (entry.startsWith("agentboard-e2e-")) {
        const fullPath = join(baseDir, entry);
        try {
          rmSync(fullPath, { recursive: true, force: true });
          console.log(`✓ Cleaned up: ${fullPath}`);
        } catch (err) {
          console.warn(`⚠ Failed to clean ${fullPath}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to clean up temp directories:", err);
  }
}
