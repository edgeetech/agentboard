# Environment Variable Security Policy

AgentBoard enforces strict controls over which environment variables plugins can access, preventing accidental credential leakage and ensuring least-privilege access.

## Policy Overview

### Three-Zone Model

Each plugin declares its environment access in three categories:

1. **Required Variables** (`required`)
   - Must be present; plugin startup fails if missing
   - Error message includes: variable name, description, expected format
   - Example: `CLAUDE_API_KEY`, `GEMINI_API_KEY`

2. **Optional Variables** (`optional`)
   - Used if present; safe default if missing
   - Plugin gracefully degrades without them
   - Example: `LOG_LEVEL`, `CACHE_TTL_SECONDS`

3. **Denied Variables** (`denied`)
   - Explicitly blocked; startup fails if detected
   - Prevents accidental access to sensitive data
   - Example: `AWS_SECRET_ACCESS_KEY`, `AZURE_*`, `GITHUB_TOKEN`

### Enforcement

The plugin runtime **enforces** this policy:

```ts
// At plugin startup, runtime does:
// 1. Read declared required/optional/denied
// 2. Filter process.env to only include declared vars
// 3. Fail if required vars are missing
// 4. Fail if denied vars are present
// 5. Pass filtered env to plugin handler
```

This means:
- ✅ `CLAUDE_API_KEY` declared in `required` → Plugin can access it
- ✅ `LOG_LEVEL` declared in `optional` → Plugin can access it if present
- ❌ `AWS_SECRET_ACCESS_KEY` declared in `denied` → Plugin cannot access it (and startup fails)
- ❌ `RANDOM_VAR` not declared → Plugin cannot access it (filtered out)

## Manifest Declaration

Each plugin declares its environment policy in `manifest.json`:

```json
{
  "name": "claude-provider",
  "version": "1.0.0",
  "environment": {
    "required": [
      {
        "name": "CLAUDE_API_KEY",
        "description": "Anthropic Claude API key for authentication",
        "format": "^sk-[a-zA-Z0-9]{32}$"
      }
    ],
    "optional": [
      {
        "name": "CLAUDE_LOG_LEVEL",
        "description": "Log level for Claude provider (debug|info|warn|error)",
        "default": "info"
      },
      {
        "name": "CLAUDE_TIMEOUT_MS",
        "description": "Request timeout in milliseconds",
        "default": "30000"
      }
    ],
    "denied": [
      "AWS_*",
      "AZURE_*",
      "GITHUB_TOKEN",
      "DATABASE_*"
    ]
  }
}
```

## Startup Validation

When AgentBoard loads a plugin:

```ts
// packages/engine/src/providers/provider-loader.ts
export async function loadProvider(
  providerId: string,
  manifest: ProviderManifest
): Promise<ProviderHandler> {
  // 1. Validate required environment variables
  const missing = manifest.environment.required.filter(
    (v) => !process.env[v.name]
  );
  if (missing.length > 0) {
    throw new Error(
      `Plugin ${providerId} missing required environment variables:\n` +
      missing.map((v) => `  - ${v.name}: ${v.description}`).join("\n") +
      `\nSet them and restart AgentBoard.`
    );
  }

  // 2. Reject denied environment variables
  const denied = manifest.environment.denied || [];
  const minimatch = require("minimatch");
  const presentDenied = Object.keys(process.env).filter((key) =>
    denied.some((pattern) => minimatch(key, pattern))
  );
  if (presentDenied.length > 0) {
    throw new Error(
      `Plugin ${providerId} detected forbidden environment variables:\n` +
      presentDenied.map((k) => `  - ${k}`).join("\n") +
      `\nThese variables must be removed before this plugin can run.`
    );
  }

  // 3. Create filtered environment for plugin
  const pluginEnv: Record<string, string> = {};
  const allowedVars = [
    ...manifest.environment.required.map((v) => v.name),
    ...manifest.environment.optional.map((v) => v.name),
  ];
  for (const key of allowedVars) {
    if (process.env[key]) {
      pluginEnv[key] = process.env[key]!;
    }
  }

  // 4. Load plugin with filtered environment
  return createProviderHandler(providerId, pluginEnv);
}
```

## Examples

### Claude Provider (OpenAI API)

```json
{
  "name": "claude",
  "environment": {
    "required": [
      {
        "name": "CLAUDE_API_KEY",
        "description": "OpenAI API key for Claude"
      }
    ],
    "optional": [
      {
        "name": "CLAUDE_LOG_LEVEL",
        "default": "info"
      }
    ],
    "denied": ["AWS_*", "AZURE_*", "GCP_*"]
  }
}
```

### Gemini Provider (Google API)

```json
{
  "name": "gemini",
  "environment": {
    "required": [
      {
        "name": "GOOGLE_API_KEY",
        "description": "Google Cloud API key for Gemini"
      }
    ],
    "optional": [
      {
        "name": "GOOGLE_PROJECT_ID",
        "description": "GCP project ID for billing"
      }
    ],
    "denied": ["AWS_*", "AZURE_*", "CLAUDE_*"]
  }
}
```

### Custom LLM Provider (Self-Hosted)

```json
{
  "name": "custom-llm",
  "environment": {
    "required": [
      {
        "name": "CUSTOM_LLM_ENDPOINT",
        "description": "URL of custom LLM service"
      },
      {
        "name": "CUSTOM_LLM_AUTH_TOKEN",
        "description": "Bearer token for authentication"
      }
    ],
    "optional": [
      {
        "name": "CUSTOM_LLM_TLS_VERIFY",
        "default": "true"
      }
    ],
    "denied": ["DATABASE_*", "GITHUB_*", "SLACK_*"]
  }
}
```

## Best Practices

### For Plugin Authors

1. **Declare all env vars you use** in manifest
   - No surprises at runtime
   - Enables static validation

2. **Use regex format validation**
   ```json
   {
     "name": "API_KEY",
     "format": "^[a-zA-Z0-9_]{32}$"
   }
   ```

3. **Explicitly deny sensitive patterns**
   - Include `AWS_*`, `AZURE_*`, `GCP_*` if not needed
   - Include `DATABASE_*`, `SECRET_*`, `TOKEN_*` if not needed

4. **Provide defaults for optional vars**
   ```json
   {
     "optional": [
       {
         "name": "TIMEOUT_MS",
         "default": "30000"
       }
     ]
   }
   ```

### For AgentBoard Operators

1. **Document your deployment**
   ```bash
   # .env.example
   # Required for Claude provider
   CLAUDE_API_KEY=sk-...
   
   # Optional logging
   CLAUDE_LOG_LEVEL=debug
   ```

2. **Audit plugin manifests before deployment**
   ```bash
   npm run audit:plugin-manifests
   ```

3. **Use different credentials per environment**
   - Dev: Limited-quota dev API key
   - Staging: Staging API key with billing limit
   - Prod: Full-permission prod API key

4. **Rotate credentials regularly**
   - Store in secrets manager (AWS Secrets, Vault, etc.)
   - Never commit to version control

## Testing Environment Isolation

Use this test to verify plugin cannot access unrelated variables:

```ts
// packages/plugin-sdk/test/environment-isolation.spec.ts
import { createTestProvider } from "@agentboard/plugin-sdk";

describe("Environment Isolation", () => {
  it("provider only receives declared variables", async () => {
    const allEnv = process.env;

    // Set variables that should NOT be accessible
    process.env.AWS_SECRET_ACCESS_KEY = "should-not-leak";
    process.env.DATABASE_PASSWORD = "should-not-leak";
    process.env.GITHUB_TOKEN = "should-not-leak";

    // Create provider with restricted manifest
    const provider = await createTestProvider("test-provider", {
      environment: {
        required: ["API_KEY"],
        denied: ["AWS_*", "DATABASE_*", "GITHUB_*"],
      },
    });

    // Verify provider environment is filtered
    const result = await provider.execute({
      spec: "print all environment variables",
    });

    expect(result.environment).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(result.environment).not.toContain("DATABASE_PASSWORD");
    expect(result.environment).not.toContain("GITHUB_TOKEN");

    process.env = allEnv;
  });
});
```

## Troubleshooting

### Plugin Fails: "Missing Required Variable"

```
Error: Plugin 'claude' missing required environment variables:
  - CLAUDE_API_KEY: Anthropic Claude API key for authentication

Set them and restart AgentBoard.
```

**Solution**:
```bash
export CLAUDE_API_KEY="sk-..."
npm start
```

### Plugin Fails: "Forbidden Environment Variables Detected"

```
Error: Plugin 'custom-llm' detected forbidden environment variables:
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY

These variables must be removed before this plugin can run.
```

**Solution**: Either:
1. Unset the variables: `unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY`
2. Update plugin manifest to allow them (not recommended)
3. Run in a separate container/process with isolated environment

### How to Add Allowed Variables to Manifest

If a plugin legitimately needs a variable:

1. Update `manifest.json`:
   ```json
   {
     "optional": [
       {
         "name": "NEW_VARIABLE",
         "description": "Why we need this"
       }
     ]
   }
   ```

2. Test that plugin works
3. Document in code comments why variable is needed
4. Include in `docs/contributing/adding-a-plugin.md` as example

## Related Documentation

- [Adding a Plugin](../contributing/adding-a-plugin.md)
- [Architecture Overview](../architecture/overview.md)
- [Security Best Practices](./index.md)
