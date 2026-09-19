# Database Migrations & Schema Management

AgentBoard uses database migrations to manage schema evolution safely across environments.

## Migration Strategy

### Tools & Workflow

- **Framework**: Drizzle ORM with SQL-based migrations
- **Directory**: `packages/db/migrations/`
- **Naming**: `YYYY-MM-DD-HH-mm-ss_description.sql`
- **Rollback**: Always create matching down migration

### Creating a Migration

1. **Update schema definition** (`packages/db/schema/index.ts`):
```ts
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  status: varchar("status", { length: 20 }).notNull(),
  result: json("result"),
  retryCount: integer("retry_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

2. **Generate migration**:
```bash
cd packages/db
npm run generate:migration -- "add_retry_count_to_runs"
```

3. **Review generated migration** in `migrations/` directory

4. **Test locally**:
```bash
npm run migrate:dev    # Apply to dev database
npm run migrate:test   # Apply to test database
npm run migrate:rollback  # Rollback to verify up/down symmetry
```

## Production Deployment

### Pre-Migration Checklist

- [ ] Tested on dev, staging, and production-like databases
- [ ] Rollback plan documented and tested
- [ ] No breaking API changes in same release
- [ ] Backward compatibility for 2+ minor versions

### Deployment Steps

1. **Announce maintenance window** (if data-heavy migration)
2. **Create database backup** (automatic in RDS)
3. **Run migration** with monitoring
4. **Verify schema** with post-migration checks
5. **Rollback playbook** ready if issues detected

### Monitoring

```sql
-- Check active locks (migration may be blocking)
SELECT pid, usename, query, query_start 
FROM pg_stat_activity 
WHERE state = 'active' AND query LIKE '%ALTER%';

-- Monitor replication lag
SELECT slot_name, restart_lsn, confirmed_flush_lsn 
FROM pg_replication_slots;
```

## Common Migration Patterns

### Adding a Column (Non-Breaking)

```sql
-- up migration
ALTER TABLE runs ADD COLUMN retry_count INTEGER DEFAULT 0 NOT NULL;

-- down migration
ALTER TABLE runs DROP COLUMN retry_count;
```

### Renaming Column (Breaking - Coordinate with API)

```sql
-- up migration
ALTER TABLE runs RENAME COLUMN retry_count TO rework_count;

-- down migration (must deprecate API field first)
ALTER TABLE runs RENAME COLUMN rework_count TO retry_count;
```

### Adding Unique Constraint

```sql
-- up migration (safe if no duplicates exist)
ALTER TABLE runs ADD UNIQUE(task_id, provider);

-- down migration
ALTER TABLE runs DROP CONSTRAINT runs_task_id_provider_key;
```

### Creating Index for Performance

```sql
-- up migration
CREATE INDEX CONCURRENTLY idx_runs_status_created 
ON runs(status, created_at) WHERE status != 'completed';

-- down migration
DROP INDEX CONCURRENTLY idx_runs_status_created;
```

## State Synchronization

### Ensuring Schema-Code Coherence

1. **Schema drives code**: Generate types from schema, not vice versa
   ```bash
   npm run generate:types  # From packages/db/schema -> packages/db/types
   ```

2. **Type validation in tests**:
   ```ts
   // Compile-time check: type must match generated schema
   const run: SelectRun = await db.query.runs.findFirst(...);
   ```

3. **Runtime validation**: Drizzle validates at query time
   ```ts
   // Will type-error if column doesn't exist in schema
   await db.update(runs).set({ nonExistentColumn: "value" });
   ```

## Testing Migrations

### Unit Tests

```ts
// packages/db/test/migrations.test.ts
describe("Migrations", () => {
  beforeEach(async () => {
    // Start from empty schema
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
  });

  it("adds retry_count column", async () => {
    await runMigration("2025-08-20-10-30-00_add_retry_count");
    
    const schema = await db.query(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'runs'
    `);
    
    expect(schema.map(r => r.column_name)).toContain("retry_count");
  });

  it("rolls back cleanly", async () => {
    await runMigration("2025-08-20-10-30-00_add_retry_count");
    await rollbackMigration("2025-08-20-10-30-00_add_retry_count");
    
    const schema = await db.query(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'runs'
    `);
    
    expect(schema.map(r => r.column_name)).not.toContain("retry_count");
  });
});
```

### Integration Tests

```ts
// Test that app works after migration
beforeAll(async () => {
  await runAllMigrations();
});

it("creates run with new schema", async () => {
  const run = await executor.createRun({
    taskId: "task-123",
    provider: "claude",
    reworkCount: 0,  // New field
  });
  
  expect(run.reworkCount).toBe(0);
});
```

## Troubleshooting

### Migration Stuck (Timeout)

```bash
# Cancel blocking migration
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE query LIKE '%ALTER TABLE%';

# Rollback manually
npm run migrate:rollback -- --step 1
```

### Rollback Failed

1. Check logs: `docker logs db-container | grep ERROR`
2. Manually verify data integrity
3. Retry rollback with `--force` flag (use with caution)
4. Contact infrastructure team if database is in inconsistent state

### Zero-Downtime Migration (Large Tables)

For tables with millions of rows, use:

```sql
-- 1. Add column in NOT NULL mode (fast, no locks)
ALTER TABLE large_table ADD COLUMN new_col VARCHAR;

-- 2. Add default value (fast on modern PostgreSQL)
ALTER TABLE large_table ALTER COLUMN new_col SET DEFAULT 'value';

-- 3. Fill existing rows in background job
UPDATE large_table SET new_col = 'value' WHERE new_col IS NULL 
  LIMIT 10000; -- Batch to avoid long locks

-- 4. Add constraint only after all rows filled
ALTER TABLE large_table ALTER COLUMN new_col SET NOT NULL;
```

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Observability & SLOs](../architecture/observability-slos.md)
- [Database Schema](../database/schema.md)
