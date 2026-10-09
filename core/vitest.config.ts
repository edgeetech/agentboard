import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    // Many suites build real SQLite DBs and spawn processes; shared CI
    // runners (macOS/Windows) regularly exceed vitest's 5s default.
    testTimeout: 30_000,
  },
});
