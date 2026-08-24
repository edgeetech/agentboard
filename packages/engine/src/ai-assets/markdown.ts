export interface ParsedMarkdownAsset {
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
}

export function parseMarkdownAsset(raw: string): ParsedMarkdownAsset {
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { frontmatter: {}, body: text };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { frontmatter: {}, body: text };

  return {
    frontmatter: parseFrontmatterLines(lines.slice(1, endIdx)),
    body: lines.slice(endIdx + 1).join("\n").replace(/^\n+/, ""),
  };
}

function parseFrontmatterLines(lines: readonly string[]): Record<string, string | readonly string[]> {
  const out: Record<string, string | readonly string[]> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }

    const key = normalizeKey(match[1] ?? "");
    const rawValue = (match[2] ?? "").trim();
    if (rawValue === "") {
      const items: string[] = [];
      i += 1;
      while (i < lines.length) {
        const blockItem = /^\s*-\s+(.*)$/.exec(lines[i] ?? "");
        if (!blockItem) break;
        items.push(unquote((blockItem[1] ?? "").trim()));
        i += 1;
      }
      out[key] = items;
      continue;
    }

    out[key] =
      rawValue.startsWith("[") && rawValue.endsWith("]")
        ? splitInlineArray(rawValue.slice(1, -1))
        : unquote(rawValue);
    i += 1;
  }
  return out;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "-");
}

function splitInlineArray(value: string): readonly string[] {
  const parts: string[] = [];
  let buffer = "";
  let quote: "'" | '"' | null = null;
  for (const char of value) {
    if (quote !== null) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === ",") {
      parts.push(unquote(buffer.trim()));
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim().length > 0) parts.push(unquote(buffer.trim()));
  return parts.filter((part) => part.length > 0);
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
