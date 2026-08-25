import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.env.AGENTBOARD_E2E_PORT ?? "5591";
const dataDir = join(tmpdir(), `agentboard-e2e-${process.pid}-${Date.now()}`);

export default defineConfig({
  testDir: "./e2e",
  outputDir: join(dataDir, "test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      `node --experimental-sqlite --experimental-strip-types --no-warnings ` +
      `plugins/claude-code/agent-board-core/server.ts --port ${port}`,
    env: {
      ...process.env,
      AGENTBOARD_DATA_DIR: dataDir,
    },
    url: `http://127.0.0.1:${port}/alive`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
