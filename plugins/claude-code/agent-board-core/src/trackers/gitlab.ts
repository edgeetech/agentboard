// GitLab REST adapter. Ported from hatice src/gitlab/client.ts + adapter.ts.

import type { Tracker, TrackerConfig, TrackerIssue } from './tracker.ts';
import { TrackerError } from './tracker.ts';

const PAGE_SIZE = 100;

/** Extract numeric issue IID from strings like "owner/project#123" or "123". */
function extractIid(issueId: string): string {
  if (issueId.includes('#')) {
    return issueId.split('#').at(-1) ?? issueId;
  }
  return issueId;
}

const SEVERITY_MAP: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PRIORITY_MAP: Record<string, number> = {
  'priority::urgent': 0,
  'priority::high': 1,
  'priority::medium': 2,
  'priority::low': 3,
};

// ── Raw REST response shapes ──────────────────────────────────────────────────

interface GitLabAssignee {
  id: number;
  username: string;
}

interface GitLabIssueRow {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  severity?: string;
  assignees?: GitLabAssignee[];
  created_at: string;
  updated_at: string;
  web_url: string;
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isGitLabIssueRow(v: unknown): v is GitLabIssueRow {
  return (
    typeof v === 'object' &&
    v !== null &&
    'iid' in v &&
    'title' in v &&
    'state' in v &&
    Array.isArray((v as Record<string, unknown>).labels)
  );
}

function isGitLabIssueArray(v: unknown): v is GitLabIssueRow[] {
  return Array.isArray(v) && v.every((item) => isGitLabIssueRow(item));
}

// ── GitLabClient ──────────────────────────────────────────────────────────────

class GitLabClient {
  #baseUrl: string;
  #apiToken: string;
  #projectPath: string;
  #assignee: string | null;

  constructor(
    endpoint: string,
    apiToken: string,
    projectPath: string,
    assignee: string | null,
  ) {
    this.#baseUrl = endpoint.replace(/\/+$/, '');
    this.#apiToken = apiToken;
    this.#projectPath = projectPath;
    this.#assignee = assignee;
  }

  #encodedProject(): string {
    return encodeURIComponent(this.#projectPath);
  }

  async #request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        'PRIVATE-TOKEN': this.#apiToken,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await fetch(`${this.#baseUrl}/api/v4${path}`, init);
    if (!resp.ok) {
      throw new TrackerError(
        `GitLab API error: ${resp.status} ${resp.statusText}`,
        resp.status,
      );
    }
    const text = await resp.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  #normalize(issue: GitLabIssueRow): TrackerIssue {
    const identifier = `${this.#projectPath}#${issue.iid}`;
    const state = issue.state === 'opened' ? 'Open' : 'Closed';
    const labels = issue.labels.map((l) => l.toLowerCase());
    let priority: number | null = null;
    for (const l of labels) {
      if (l in PRIORITY_MAP) {
        priority = PRIORITY_MAP[l] ?? null;
        break;
      }
    }
    if (priority === null) {
      const sev = issue.severity?.toLowerCase();
      if (sev && sev !== 'unknown' && sev in SEVERITY_MAP) {
        priority = SEVERITY_MAP[sev] ?? null;
      }
    }
    const assignedToWorker =
      this.#assignee !== null
        ? (issue.assignees ?? []).some(
            (a) => a.username === this.#assignee,
          )
        : false;
    const assigneeId =
      issue.assignees?.[0] !== undefined
        ? String(issue.assignees[0].id)
        : null;
    return {
      id: identifier,
      identifier,
      title: issue.title,
      description: issue.description,
      state,
      priority,
      labels,
      blockedBy: [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      assignedToWorker,
      url: issue.web_url,
      branchName: null,
      assigneeId,
    };
  }

  #mapStates(states: string[]): string {
    for (const s of states) {
      const l = s.toLowerCase();
      if (l === 'closed' || l === 'done' || l === 'cancelled') return 'closed';
    }
    return 'opened';
  }

  async fetchIssues(states: string[]): Promise<TrackerIssue[]> {
    const glState = this.#mapStates(states);
    const all: TrackerIssue[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams({
        state: glState,
        per_page: String(PAGE_SIZE),
        page: String(page),
        order_by: 'created_at',
        sort: 'asc',
      });
      if (this.#assignee) params.set('assignee_username', this.#assignee);
      const raw = await this.#request(
        'GET',
        `/projects/${this.#encodedProject()}/issues?${params.toString()}`,
      );
      if (!isGitLabIssueArray(raw)) {
        throw new TrackerError('GitLab API: unexpected issues response shape');
      }
      all.push(...raw.map((i) => this.#normalize(i)));
      hasMore = raw.length === PAGE_SIZE;
      page++;
    }
    return all;
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    if (ids.length === 0) return [];
    const results: TrackerIssue[] = [];
    for (const id of ids) {
      const iid = extractIid(id);
      const raw = await this.#request(
        'GET',
        `/projects/${this.#encodedProject()}/issues/${iid}`,
      );
      if (!isGitLabIssueRow(raw)) {
        throw new TrackerError(
          `GitLab API: unexpected issue response shape for id ${id}`,
        );
      }
      results.push(this.#normalize(raw));
    }
    return results;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const iid = extractIid(issueId);
    await this.#request(
      'POST',
      `/projects/${this.#encodedProject()}/issues/${iid}/notes`,
      { body },
    );
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const iid = extractIid(issueId);
    const l = stateName.toLowerCase();
    const state_event = l === 'closed' || l === 'done' ? 'close' : 'reopen';
    await this.#request(
      'PUT',
      `/projects/${this.#encodedProject()}/issues/${iid}`,
      { state_event },
    );
  }
}

// ── GitLabAdapter ─────────────────────────────────────────────────────────────

export class GitLabAdapter implements Tracker {
  #client: GitLabClient;
  #activeStates: string[];

  constructor(config: TrackerConfig) {
    this.#client = new GitLabClient(
      config.endpoint ?? 'https://gitlab.com',
      config.apiKey ?? '',
      config.projectSlug ?? '',
      config.assignee ?? null,
    );
    this.#activeStates = config.activeStates ?? ['Open'];
  }

  async fetchCandidateIssues(): Promise<TrackerIssue[]> {
    return this.#client.fetchIssues(this.#activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]> {
    return this.#client.fetchIssues(states);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    return this.#client.fetchIssueStatesByIds(ids);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    return this.#client.createComment(issueId, body);
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    return this.#client.updateIssueState(issueId, stateName);
  }
}
