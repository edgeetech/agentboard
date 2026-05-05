// Tracker interface definition

export interface BlockerRef {
  id: string;
  identifier: string;
  state: string;
}

export interface TrackerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: number | null;
  labels: string[];
  blockedBy: BlockerRef[];
  createdAt: string;
  updatedAt: string;
  assignedToWorker: boolean;
  url: string | null;
  branchName: string | null;
  assigneeId: string | null;
}

export interface TrackerConfig {
  kind: 'linear' | 'github' | 'gitlab' | 'memory';
  endpoint?: string;
  apiKey?: string;
  projectSlug?: string;
  assignee?: string | null;
  activeStates?: string[];
}

/**
 * Tracker interface. Implementations must provide these methods.
 *
 * @method fetchCandidateIssues  - fetch all active/open issues
 * @method fetchIssuesByStates   - fetch issues matching given state names
 * @method fetchIssueStatesByIds - fetch issues by IDs (for status reconciliation)
 * @method createComment         - post a comment on an issue
 * @method updateIssueState      - change issue state (e.g. close/reopen)
 */
export interface Tracker {
  fetchCandidateIssues(): Promise<TrackerIssue[]>;
  fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]>;
  createComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateName: string): Promise<void>;
}

export class TrackerError extends Error {
  status: number | null;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TrackerError';
    this.status = status ?? null;
  }
}
