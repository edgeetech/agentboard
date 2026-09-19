# Observability & SLO Targets

AgentBoard defines SLO targets for production observability and alerting.

## Key Metrics

### Queue & Orchestration

| Metric | Target | P99 Alert | Definition |
|--------|--------|-----------|-----------|
| Queue Latency | <5s | >10s | Time from task creation to run claim |
| Claim Latency | <100ms | >250ms | Time to claim a run from queue |
| Execution Latency | <30s | >60s | Time to invoke provider and get result |
| Post-Flight Latency | <500ms | >1s | Time for validation and recording after execution |

### Provider Performance

| Metric | Target | P99 Alert | Definition |
|--------|--------|-----------|-----------|
| Provider Availability | >99% | <98% | % of runs that start (not availability checks) |
| Execution Success Rate | >95% | <90% | % of executions that complete without error |
| Timeout Rate | <2% | >5% | % of runs that timeout |
| Rate Limit Rate | <1% | >3% | % of runs rate-limited |

### API & HTTP

| Metric | Target | P99 Alert | Definition |
|--------|--------|-----------|-----------|
| API Response Time (p50) | <100ms | - | Median API latency |
| API Response Time (p99) | <200ms | >500ms | 99th percentile API latency |
| API Error Rate | <1% | >2% | % of API requests with errors (5xx) |
| API Rate Limit | 1000 req/min | 800 req/min | Threshold for client rate limiting |

### Database

| Metric | Target | P99 Alert | Definition |
|--------|--------|-----------|-----------|
| Query Latency (p50) | <10ms | - | Median query time |
| Query Latency (p99) | <100ms | >250ms | 99th percentile query time |
| Transaction Abort Rate | <1% | >2% | % of transactions aborted (optimistic lock) |
| Connection Pool Saturation | <70% | >90% | % of available connections in use |

### Cost

| Metric | Target | Alert | Definition |
|--------|--------|-------|-----------|
| Avg Cost Per Run | <$0.10 | >$0.15 | Average USD cost per execution |
| Daily Cost Cap | <$1000/day | >$800/day | Alert if daily spending exceeds threshold |
| Token Efficiency | >100k tok/$ | <80k tok/$ | Average tokens per dollar |

## Alerting Rules

### Critical (Page On-Call)

- Execution success rate <90%
- API error rate >5%
- Provider availability <95%
- Database connection pool >95% saturated

### High (Notify Team)

- Execution success rate <95%
- API response time p99 >500ms
- Queue latency >10s
- Rate limit rate >5%
- Daily cost >$800/day

### Medium (Log to Dashboards)

- Timeout rate >5%
- API response time p99 >200ms
- Query latency p99 >250ms
- Provider-specific errors

## Dashboard Queries

### Execution Success Dashboard

```sql
SELECT
  DATE(timestamp) as date,
  provider,
  COUNT(*) as total_runs,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate,
  AVG(duration_ms) as avg_duration_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_duration_ms,
  SUM(cost_usd) as daily_cost
FROM execution_runs
GROUP BY DATE(timestamp), provider
ORDER BY date DESC, provider;
```

### Queue Latency Dashboard

```sql
SELECT
  DATE(timestamp) as date,
  role,
  COUNT(*) as total_runs,
  AVG(queue_latency_ms) as avg_queue_latency,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY queue_latency_ms) as p50_queue_latency,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY queue_latency_ms) as p99_queue_latency,
  MAX(queue_latency_ms) as max_queue_latency
FROM execution_runs
GROUP BY DATE(timestamp), role
ORDER BY date DESC, role;
```

### Provider Error Distribution

```sql
SELECT
  provider,
  error_kind,
  COUNT(*) as error_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY provider), 2) as pct
FROM execution_errors
WHERE DATE(timestamp) >= CURRENT_DATE - INTERVAL 7 DAY
GROUP BY provider, error_kind
ORDER BY provider, error_count DESC;
```

## Runbooks

### High Execution Failure Rate

**Symptom**: Execution success rate drops below 90%

**Investigation**:
1. Check which providers are failing: `SELECT provider, error_kind, COUNT(*) FROM execution_errors WHERE timestamp > NOW() - INTERVAL 1 HOUR GROUP BY provider, error_kind`
2. Check provider status pages for outages
3. Verify provider authentication is still valid
4. Check provider rate limit status

**Mitigation**:
- Disable failing provider temporarily: Set `DISABLED_PROVIDERS=provider-id`
- Redirect work to alternative providers
- Scale down queue to prevent backlog

### High API Latency

**Symptom**: API response time p99 >500ms

**Investigation**:
1. Check database query latency: `SELECT query, avg_duration_ms FROM query_performance WHERE timestamp > NOW() - INTERVAL 1 HOUR ORDER BY avg_duration_ms DESC LIMIT 10`
2. Check connection pool saturation
3. Check if long-running transactions are blocking

**Mitigation**:
- Increase database connection pool size
- Enable query result caching
- Scale API servers horizontally

### Rate Limiting

**Symptom**: Rate limit rate >5%

**Investigation**:
1. Check which provider is rate limiting: `SELECT provider, retryAfterMs, COUNT(*) FROM rate_limit_events WHERE timestamp > NOW() - INTERVAL 1 HOUR GROUP BY provider, retryAfterMs`
2. Check provider quota usage
3. Verify backoff policy is working

**Mitigation**:
- Increase retry backoff delay
- Reduce concurrent request rate to provider
- Request quota increase from provider

## Recording Structured Logs

The orchestration logger should emit these events:

```ts
const logger = createOrchestrationLogger();

// When run is claimed
logger.runClaimed({
  runId: "run-123",
  taskId: "task-456",
  provider: "claude",
  role: "worker",
  projectId: "proj-789",
  queuedAtEpochMs: 1000,
  claimedAtEpochMs: 2000,
});

// When execution starts
logger.executionStarted({
  runId: "run-123",
  provider: "claude",
  role: "worker",
  promptSizeBytes: 5240,
  estimatedDuration: "medium",
});

// When execution completes
logger.executionCompleted({
  runId: "run-123",
  provider: "claude",
  duration: 28500,
  inputTokens: 1500,
  outputTokens: 850,
  costUsd: 0.065,
});

// When execution fails
logger.executionFailed({
  runId: "run-123",
  provider: "claude",
  duration: 30200,
  error: "Request timeout after 30s",
  errorKind: "timeout",
  retryScheduled: true,
});
```

## Related Documentation

- [Post-Review Recommendations](../refactoring/post-review-recommendations.md)
- [Quick Wins & Follow-Ups](../refactoring/quick-wins-and-follow-ups.md)
- [Architecture Overview](./overview.md)
