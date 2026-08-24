import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];

function posix(path) {
  return path.split(sep).join("/");
}

function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function sourceFiles(dir) {
  return walk(dir, (path) =>
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(
      extname(path),
    ),
  );
}

function importsFrom(text) {
  const imports = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) imports.push(match[1]);
  }
  return imports;
}

function scanImports(dir, rules) {
  for (const file of sourceFiles(join(root, dir))) {
    const rel = posix(relative(root, file));
    const text = readFileSync(file, "utf8");
    for (const specifier of importsFrom(text)) {
      for (const rule of rules) {
        if (rule.test(specifier))
          failures.push(
            `${rel}: forbidden import '${specifier}' (${rule.reason})`,
          );
      }
    }
  }
}

scanImports("packages/engine", [
  {
    test: (s) => s.includes("plugins/"),
    reason: "engine must not import plugins",
  },
  {
    test: (s) => s.includes("packages/infrastructure"),
    reason: "engine must not import infrastructure",
  },
  {
    test: (s) => s.includes("server/"),
    reason: "engine must not import server",
  },
  { test: (s) => s.includes("apps/"), reason: "engine must not import UI" },
]);

scanImports("apps/ui", [
  {
    test: (s) =>
      s.includes("persistence/sqlite") || s.includes("packages/infrastructure"),
    reason: "UI must not import persistence",
  },
  {
    test: (s) => s.includes("plugins/providers"),
    reason: "UI must not import provider runtimes",
  },
]);

scanImports("packages/contracts", [
  {
    test: (s) => s.includes("packages/engine"),
    reason: "contracts must not import engine",
  },
  {
    test: (s) => s.includes("packages/infrastructure"),
    reason: "contracts must not import infrastructure",
  },
  {
    test: (s) => s.includes("plugins/"),
    reason: "contracts must not import plugins",
  },
  { test: (s) => s.includes("server/"), reason: "contracts must not import server" },
  { test: (s) => s.includes("apps/"), reason: "contracts must not import UI" },
]);

scanImports("packages/infrastructure", [
  {
    test: (s) => s.includes("plugins/"),
    reason: "infrastructure must not import plugins",
  },
  { test: (s) => s.includes("server/"), reason: "infrastructure must not import server" },
  { test: (s) => s.includes("apps/"), reason: "infrastructure must not import UI" },
]);

scanImports("packages/plugin-sdk", [
  {
    test: (s) => s.includes("plugins/"),
    reason: "plugin SDK must not import plugin implementations",
  },
  {
    test: (s) => s.includes("packages/infrastructure"),
    reason: "plugin SDK must not import infrastructure",
  },
  { test: (s) => s.includes("server/"), reason: "plugin SDK must not import server" },
  { test: (s) => s.includes("apps/"), reason: "plugin SDK must not import UI" },
]);

scanImports("plugins/providers", [
  {
    test: (s) => s.includes("agent-board-core"),
    reason: "provider packages must not import legacy runtime internals",
  },
  {
    test: (s) => s.includes("packages/engine"),
    reason: "provider packages should implement plugin SDK contracts, not engine internals",
  },
  {
    test: (s) => s.includes("packages/infrastructure"),
    reason: "provider packages must not import infrastructure",
  },
  { test: (s) => s.includes("server/"), reason: "provider packages must not import server" },
  { test: (s) => s.includes("apps/"), reason: "provider packages must not import UI" },
]);

scanImports("server", [
  {
    test: (s) =>
      s.includes("packages/infrastructure/src/persistence/sqlite/repositories"),
    reason: "server handlers should not import DB internals directly",
  },
]);

scanImports("plugins/claude-code/agent-board-core/src", [
  {
    test: (s) => s.includes("packages/"),
    reason:
      "legacy runtime must not import repo-root packages until plugin packaging guarantees them",
  },
]);

const aiDir = join(root, "ai");
for (const file of walk(aiDir)) {
  if (extname(file) !== ".md")
    failures.push(
      `${posix(relative(root, file))}: ai/ must contain Markdown files only`,
    );
}

if (failures.length > 0) {
  console.error("Architecture check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Architecture check passed.");
