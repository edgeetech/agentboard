# Architecture Overview

AgentBoard implements a modular multi-provider orchestration system that decouples Engine logic from provider-specific implementations.

## System Architecture

```mermaid
graph TB
    subgraph "API Layer"
        REST["REST API<br/>(Express.js)"]
        AUTH["Authentication<br/>(JWT/RBAC)"]
    end

    subgraph "Application Layer"
        COORD["Run Coordinator<br/>(Orchestration)"]
        POLICY["Rate Limit Policy<br/>(Backoff/Retry)"]
        EXECUTOR["Executor<br/>(Task → Provider)"]
    end

    subgraph "Persistence Layer"
        QUEUE["Task Queue<br/>(Database)"]
        STATE["Run State<br/>(Database)"]
        CACHE["Result Cache<br/>(Optional)"]
    end

    subgraph "Provider Ecosystem"
        SDK["Provider SDK<br/>(Contracts)"]
        PKG1["Claude Provider<br/>(OpenAI API)"]
        PKG2["Gemini Provider<br/>(Google API)"]
        PKG3["Custom Provider<br/>(User-Defined)"]
    end

    subgraph "Observability"
        LOG["Structured Logger<br/>(Events)"]
        TRACE["Tracer<br/>(OpenTelemetry)"]
        METRICS["Metrics<br/>(Prometheus)"]
    end

    REST --> AUTH
    AUTH --> COORD
    COORD --> POLICY
    POLICY --> EXECUTOR
    EXECUTOR --> QUEUE
    EXECUTOR --> STATE
    QUEUE --> CACHE
    COORD --> SDK
    SDK --> PKG1
    SDK --> PKG2
    SDK --> PKG3
    COORD --> LOG
    LOG --> TRACE
    LOG --> METRICS
```

## Data Flow: Executing a Task

```mermaid
sequenceDiagram
    participant C as Client
    participant API as REST API
    participant Q as Task Queue
    participant W as Worker
    participant E as Executor
    participant P as Provider
    participant S as State Machine

    C->>API: POST /tasks (with spec)
    API->>Q: Create task record
    Q-->>API: task_id, status=enqueued
    API-->>C: 201 {task_id}

    W->>Q: Poll for available tasks
    Q-->>W: Offer task
    W->>S: Claim run
    S-->>W: run_id, status=claimed

    W->>E: Execute run
    E->>P: Call provider (with timeout)
    P-->>E: result | error
    
    alt Timeout
        E->>S: Record timeout error
        S->>S: Apply backoff policy
        S-->>W: Retry scheduled
    else Success
        E->>S: Record completion
        S->>S: Update state
        S-->>W: run complete
    else Transient Error
        E->>S: Record error + retry delay
        S-->>W: Retry scheduled
    end
    
    W->>API: GET /tasks/{id}
    API->>S: Fetch final state
    S-->>API: status=completed, result
    API-->>C: 200 {result}
```

## Provider Integration Pattern

Each provider implements the SDK contract without requiring Engine changes:

```
providers/
├── claude/                       # OpenAI API provider
│   ├── manifest.json            # Provider metadata
│   ├── src/
│   │   ├── index.ts             # Entry point
│   │   └── handler.ts           # OpenAI API integration
│   ├── dist/                    # Pre-bundled (verified in CI)
│   ├── package.json
│   └── tsconfig.json
├── gemini/                       # Google API provider
│   ├── manifest.json
│   ├── src/index.ts
│   └── dist/
└── custom-llm/                   # User-provided provider
    ├── manifest.json
    └── src/index.ts
```

**Provider Contract** (`plugin-sdk`):

```ts
interface ProviderHandler {
  // Execute task with provider-specific API
  execute(request: ExecuteRequest): Promise<ExecuteResponse>;
  
  // Validate provider auth at startup
  validateConnection(): Promise<void>;
  
  // Declare required environment variables
  getEnvVariables(): EnvironmentVariable[];
}
```

## State Machine: Run Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ENQUEUED: Create task
    ENQUEUED --> CLAIMED: Worker claims
    CLAIMED --> EXECUTING: Begin execution
    EXECUTING --> COMPLETED: Success
    EXECUTING --> FAILED: Error
    FAILED --> ENQUEUED: Retry scheduled
    COMPLETED --> [*]
    
    note right of EXECUTING
        Rate limit policy enforces
        backoff + retry strategy
    end
```

## Dependency Isolation

AgentBoard uses architecture checks to prevent:
- Engine importing from providers (provider-specific logic leakage)
- Providers importing from each other (provider coupling)
- Framework code from tightly coupling to persistence

```
✅ ALLOWED IMPORTS
- Engine → plugin-sdk (contracts only)
- Provider → plugin-sdk (contracts only)
- Provider → @provider/shared (peer utilities)

❌ FORBIDDEN IMPORTS
- Engine → Provider code
- Provider → Engine code
- Provider A → Provider B code
```

Enforced by `.eslintrc.cjs` architecture rule (see Configuration).

## Configuration Hierarchy

```
1. Environment Variables (highest priority)
   - PROVIDER_* (provider-specific API keys)
   - LOG_LEVEL (debug|info|warn|error)
   - QUEUE_POLL_INTERVAL_MS
   
2. Manifest Files (provider defaults)
   - providers/*/manifest.json
   - Rate limits, concurrency, timeouts
   
3. Code Defaults (lowest priority)
   - engine/src/application/constants.ts
   - Global timeouts, backoff strategy
```

Provider env variables are **validated at startup** and fail-fast if missing.

## Deployment Units

| Component | Deploy Strategy | Restart Impact |
|-----------|-----------------|-----------------|
| API Server | Stateless, scale horizontally | None (clients reconnect) |
| Task Queue (DB) | Persistent, backup regularly | All workers pause (graceful) |
| Worker Pool | Stateless, scale horizontally | In-flight tasks timeout & retry |
| Providers (bundles) | Pre-built, verified in CI | Must rebuild & redeploy if changed |

## Performance Targets

- **API Response**: p50 <100ms, p99 <200ms
- **Queue Latency**: <5s (enqueue → claim)
- **Execution**: <30s (invoke → result)
- **Success Rate**: >95%
- **Cost/Run**: <$0.10

See [Observability & SLOs](./observability-slos.md) for full metrics.

## Related Documentation

- [Provider Integration Guide](../contributing/adding-a-plugin.md)
- [Observability & SLOs](./observability-slos.md)
- [Database Schema](../database/schema.md)
- [API Reference](../api/index.md)
