import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const claudeLauncher = join(repoRoot, "plugins", "claude-code", "bin", "ensure-server.ts");
const codexLauncher = join(repoRoot, "plugins", "codex", "bin", "ensure-server.ts");

function runLauncher(launcher: string, args: string[], env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", launcher, ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

describe("host launcher", () => {
  let tmp: string;
  let runtime: string;
  let dataDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ab-launcher-"));
    runtime = join(tmp, "checkout", "core");
    dataDir = join(tmp, "data");
    mkdirSync(join(runtime, "bin"), { recursive: true });
    mkdirSync(dataDir);
    // Stand-in CLI: records the arguments it was called with.
    writeFileSync(
      join(runtime, "bin", "agentboard.ts"),
      `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(join(tmp, "argv.json"))}, JSON.stringify(process.argv.slice(2)));\n`,
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is shared verbatim by the Claude Code and Codex plugins", () => {
    expect(readFileSync(codexLauncher, "utf8")).toBe(readFileSync(claudeLauncher, "utf8"));
  });

  it("forwards the command to the runtime named by AGENTBOARD_RUNTIME", () => {
    const res = runLauncher(claudeLauncher, ["status", "--json"], {
      AGENTBOARD_RUNTIME: runtime,
      AGENTBOARD_DATA_DIR: dataDir,
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(readFileSync(join(tmp, "argv.json"), "utf8"))).toEqual(["status", "--json"]);
  });

  it("accepts a repo checkout as AGENTBOARD_RUNTIME and defaults to start", () => {
    const res = runLauncher(codexLauncher, [], {
      AGENTBOARD_RUNTIME: join(tmp, "checkout"),
      AGENTBOARD_DATA_DIR: dataDir,
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(readFileSync(join(tmp, "argv.json"), "utf8"))).toEqual(["start"]);
  });

  it("records a boot error when the runtime cannot be installed", () => {
    const res = runLauncher(claudeLauncher, ["status"], {
      AGENTBOARD_RUNTIME: join(tmp, "missing"),
      AGENTBOARD_RUNTIME_REPO: join(tmp, "no-such-repo"),
      AGENTBOARD_DATA_DIR: dataDir,
      // Keep the dev-checkout fallback out of the way.
      AGENTBOARD_SKIP_CHECKOUT: "1",
    });
    expect(res.status).toBe(6);
    const cfg = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as { boot_error?: string };
    expect(cfg.boot_error).toMatch(/could not clone|git is required/);
  });
});
