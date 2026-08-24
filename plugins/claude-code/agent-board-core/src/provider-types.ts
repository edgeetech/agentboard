export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface SessionLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface RunResult {
  status: 'completed' | 'failed' | 'cancelled';
  sessionId?: string | null;
  usage?: TokenUsage;
  model?: string | null;
  totalCostUsd?: number | null;
  error?: string;
  /** Present when status='failed'; 'timeout' marks TurnTimeout aborts so executor can skip auto-retry. */
  errorKind?: 'timeout' | 'error';
}
