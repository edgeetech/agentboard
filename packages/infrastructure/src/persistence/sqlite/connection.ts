export interface SqliteStatementPort {
  run(...args: readonly unknown[]): unknown;
  get(...args: readonly unknown[]): unknown;
  all(...args: readonly unknown[]): readonly unknown[];
}

export interface SqliteConnectionPort {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatementPort;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface SqliteDatabaseFactoryPort {
  open(path: string): SqliteConnectionPort;
}
