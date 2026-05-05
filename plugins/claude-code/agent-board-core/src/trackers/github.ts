// GitHub REST+GraphQL adapter. Ported from hatice src/github/client.ts + adapter.ts.

import type { Tracker, TrackerConfig, TrackerIssue } from './tracker.ts';
import { TrackerError } from './tracker.ts';

const PAGE_SIZE = 50;

/** Extract numeric issue identifier from strings like "owner/repo#123" or "123". */
function extractIssueNumber(issueId: string): string {
  if (issueId.includes('#')) {
    return issueId.split('#').at(-1) ?? issueId;
  }
  return issueId;
}

const PRIORITY_MAP: Record<string, number> = {
  'priority: urgent': 0,
  'priority: high': 1,
  'priority: medium': 2,
  'priority: low': 3,
};

const ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $states: [IssueState!]!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      issues(states: $states, first: $first, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
        nodes {
          id number title body state url createdAt updatedAt
          assignees(first: 10) { nodes { login id } }
          labels(first: 20) { nodes { name } }
          projectItems(first: 5) {
            nodes { fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } }
          }
          trackedInIssues(first: 10) { nodes { id number state } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const ISSUES_BY_IDS_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id number title body state url createdAt updatedAt
        assignees(first: 10) { nodes { login id } }
        labels(first: 20) { nodes { name } }
        projectItems(first: 5) {
          nodes { fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } }
        }
        trackedInIssues(first: 10) { nodes { id number state } }
      }
    }
  }
`;

// ── Raw GraphQL response shapes ───────────────────────────────────────────────

interface GitHubAssigneeNode {
  login: string;
  id: string;
}

interface GitHubLabelNode {
  name: string;
}

interface GitHubProjectItemFieldValue {
  name?: string;
}

interface GitHubProjectItem {
  fieldValueByName: GitHubProjectItemFieldValue | null;
}

interface GitHubTrackedIssueNode {
  id: string;
  number: number;
  state: string;
}

interface GitHubIssueNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  assignees: { nodes: GitHubAssigneeNode[] };
  labels: { nodes: GitHubLabelNode[] };
  projectItems: { nodes: GitHubProjectItem[] };
  trackedInIssues: { nodes: GitHubTrackedIssueNode[] };
}

interface GitHubPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GitHubIssuesConnection {
  nodes: GitHubIssueNode[];
  pageInfo: GitHubPageInfo;
}

interface GitHubIssuesData {
  repository: { issues: GitHubIssuesConnection };
}

interface GitHubNodeData {
  nodes: (GitHubIssueNode | null)[];
}

// ── Type guards ───────────────────────────────────────────────────────────────

function hasRepository(data: unknown): data is GitHubIssuesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'repository' in data &&
    typeof (data as Record<string, unknown>).repository === 'object'
  );
}

function hasNodes(data: unknown): data is GitHubNodeData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'nodes' in data &&
    Array.isArray((data as Record<string, unknown>).nodes)
  );
}

// ── GraphQL/REST response envelope ───────────────────────────────────────────

interface GqlEnvelope {
  data?: unknown;
  errors?: { message: string }[];
}

function isGqlEnvelope(v: unknown): v is GqlEnvelope {
  return typeof v === 'object' && v !== null;
}

// ── GitHubClient ──────────────────────────────────────────────────────────────

class GitHubClient {
  #apiToken: string;
  #owner: string;
  #repo: string;
  #assignee: string | null;

  constructor(
    apiToken: string,
    owner: string,
    repo: string,
    assignee: string | null,
  ) {
    this.#apiToken = apiToken;
    this.#owner = owner;
    this.#repo = repo;
    this.#assignee = assignee;
  }

  async #graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      throw new TrackerError(
        `GitHub API error: ${resp.status} ${resp.statusText}`,
        resp.status,
      );
    }
    const json: unknown = await resp.json();
    if (!isGqlEnvelope(json)) {
      throw new TrackerError('GitHub API returned unexpected response shape');
    }
    if (json.errors && json.errors.length > 0) {
      throw new TrackerError(
        `GitHub GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`,
      );
    }
    return json.data;
  }

  async #rest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await fetch(`https://api.github.com${path}`, init);
    if (!resp.ok) {
      throw new TrackerError(
        `GitHub REST error: ${resp.status} ${resp.statusText}`,
        resp.status,
      );
    }
    const text = await resp.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  #normalize(node: GitHubIssueNode): TrackerIssue {
    const identifier = `${this.#owner}/${this.#repo}#${node.number}`;
    let state = node.state === 'OPEN' ? 'Open' : 'Closed';
    const pi = node.projectItems.nodes[0];
    if (pi?.fieldValueByName?.name) state = pi.fieldValueByName.name;
    const labels = node.labels.nodes.map((l) => l.name.toLowerCase());
    let priority: number | null = null;
    for (const l of labels) {
      if (l in PRIORITY_MAP) {
        priority = PRIORITY_MAP[l] ?? null;
        break;
      }
    }
    const blockedBy = node.trackedInIssues.nodes.map((r) => ({
      id: r.id,
      identifier: `${this.#owner}/${this.#repo}#${r.number}`,
      state: r.state,
    }));
    const assignedToWorker =
      this.#assignee !== null
        ? node.assignees.nodes.some((a) => a.login === this.#assignee)
        : false;
    const assigneeId = node.assignees.nodes[0]?.id ?? null;
    return {
      id: node.id,
      identifier,
      title: node.title,
      description: node.body,
      state,
      priority,
      labels,
      blockedBy,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      assignedToWorker,
      url: node.url,
      branchName: null,
      assigneeId,
    };
  }

  #mapStates(states: string[]): string[] {
    const out = new Set<string>();
    for (const s of states) {
      const l = s.toLowerCase();
      if (l === 'closed' || l === 'done' || l === 'cancelled') {
        out.add('CLOSED');
      } else {
        out.add('OPEN');
      }
    }
    return [...out];
  }

  async fetchIssues(states: string[], after?: string): Promise<TrackerIssue[]> {
    const ghStates = this.#mapStates(states);
    const all: TrackerIssue[] = [];
    let cursor: string | null = after ?? null;
    let hasNext = true;
    while (hasNext) {
      const data = await this.#graphql(ISSUES_QUERY, {
        owner: this.#owner,
        repo: this.#repo,
        states: ghStates,
        first: PAGE_SIZE,
        after: cursor,
      });
      if (!hasRepository(data)) {
        throw new TrackerError(
          'GitHub API: unexpected issues response shape',
        );
      }
      const conn = data.repository.issues;
      all.push(...conn.nodes.map((n) => this.#normalize(n)));
      hasNext = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor ?? null;
    }
    return all;
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    if (ids.length === 0) return [];
    const data = await this.#graphql(ISSUES_BY_IDS_QUERY, { ids });
    if (!hasNodes(data)) {
      throw new TrackerError(
        'GitHub API: unexpected issues-by-ids response shape',
      );
    }
    return data.nodes
      .filter((n): n is GitHubIssueNode => n !== null)
      .map((n) => this.#normalize(n));
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const num = extractIssueNumber(issueId);
    await this.#rest(
      'POST',
      `/repos/${this.#owner}/${this.#repo}/issues/${num}/comments`,
      { body },
    );
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const num = extractIssueNumber(issueId);
    const state = stateName.toLowerCase() === 'closed' ? 'closed' : 'open';
    await this.#rest(
      'PATCH',
      `/repos/${this.#owner}/${this.#repo}/issues/${num}`,
      { state },
    );
  }
}

// ── GitHubAdapter ─────────────────────────────────────────────────────────────

export class GitHubAdapter implements Tracker {
  #client: GitHubClient;
  #activeStates: string[];

  constructor(config: TrackerConfig) {
    const parts = (config.projectSlug ?? '').split('/');
    if (parts.length !== 2) {
      throw new Error('GitHub projectSlug must be "owner/repo"');
    }
    const [owner, repo] = parts as [string, string];
    this.#client = new GitHubClient(
      config.apiKey ?? '',
      owner,
      repo,
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
