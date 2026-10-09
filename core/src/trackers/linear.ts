// Linear GraphQL adapter. Ported from hatice src/linear/client.ts + adapter.ts.

import type { Tracker, TrackerConfig, TrackerIssue } from './tracker.ts';
import { TrackerError } from './tracker.ts';

const ISSUE_PAGE_SIZE = 50;

const ISSUES_QUERY = `
  query Issues($filter: IssueFilter, $first: Int, $after: String) {
    issues(filter: $filter, first: $first, after: $after) {
      nodes {
        id identifier title description
        state { name }
        priority branchName url
        assignee { id name }
        labels { nodes { name } }
        inverseRelations { nodes { type issue { id identifier state { name } } } }
        createdAt updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_BY_IDS_QUERY = `
  query IssuesByIds($filter: IssueFilter) {
    issues(filter: $filter) {
      nodes {
        id identifier title description
        state { name }
        priority branchName url
        assignee { id name }
        labels { nodes { name } }
        inverseRelations { nodes { type issue { id identifier state { name } } } }
        createdAt updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }
`;

const WORKFLOW_STATES_QUERY = `
  query WorkflowStates($filter: WorkflowStateFilter) {
    workflowStates(filter: $filter) { nodes { id name } }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($issueId: String!, $stateId: String!) {
    issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
  }
`;

const VIEWER_QUERY = `query Viewer { viewer { id name email } }`;

// ── Raw GraphQL response shapes ──────────────────────────────────────────────

interface LinearLabelNode {
  name: string;
}

interface LinearStateRef {
  name: string;
}

interface LinearAssignee {
  id: string;
  name: string;
}

interface LinearRelationIssue {
  id: string;
  identifier: string;
  state: LinearStateRef;
}

interface LinearRelationNode {
  type: string;
  issue: LinearRelationIssue;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: LinearStateRef;
  priority: number | null;
  branchName: string | null;
  url: string | null;
  assignee: LinearAssignee | null;
  labels: { nodes: LinearLabelNode[] };
  inverseRelations: { nodes: LinearRelationNode[] };
  createdAt: string;
  updatedAt: string;
}

interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface LinearIssuesConnection {
  nodes: LinearIssueNode[];
  pageInfo: LinearPageInfo;
}

interface LinearIssuesData {
  issues: LinearIssuesConnection;
}

interface LinearWorkflowStateNode {
  id: string;
  name: string;
}

interface LinearWorkflowStatesData {
  workflowStates: { nodes: LinearWorkflowStateNode[] };
}

interface LinearViewerData {
  viewer: { id: string; name: string; email: string };
}

// ── Type guards ───────────────────────────────────────────────────────────────

function hasIssues(data: unknown): data is LinearIssuesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'issues' in data &&
    typeof (data as Record<string, unknown>).issues === 'object'
  );
}

function hasWorkflowStates(data: unknown): data is LinearWorkflowStatesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'workflowStates' in data &&
    typeof (data as Record<string, unknown>).workflowStates === 'object'
  );
}

function hasViewer(data: unknown): data is LinearViewerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'viewer' in data &&
    typeof (data as Record<string, unknown>).viewer === 'object'
  );
}

// ── GraphQL response envelope ─────────────────────────────────────────────────

interface GqlEnvelope {
  data?: unknown;
  errors?: { message: string }[];
}

function isGqlEnvelope(v: unknown): v is GqlEnvelope {
  return typeof v === 'object' && v !== null;
}

// ── LinearClient ─────────────────────────────────────────────────────────────

class LinearClient {
  #endpoint: string;
  #apiKey: string;
  #projectSlug: string;
  #assignee: string | null;

  constructor(
    endpoint: string,
    apiKey: string,
    projectSlug: string,
    assignee: string | null,
  ) {
    this.#endpoint = endpoint;
    this.#apiKey = apiKey;
    this.#projectSlug = projectSlug;
    this.#assignee = assignee;
  }

  get assignee(): string | null {
    return this.#assignee;
  }

  set assignee(v: string | null) {
    this.#assignee = v;
  }

  async #graphql(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 30_000);
    try {
      const resp = await fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.#apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new TrackerError(
          `Linear API HTTP ${resp.status}: ${resp.statusText}`,
          resp.status,
        );
      }
      const json: unknown = await resp.json();
      if (!isGqlEnvelope(json)) {
        throw new TrackerError('Linear API returned unexpected response shape');
      }
      if (json.errors && json.errors.length > 0) {
        throw new TrackerError(
          `Linear GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
        );
      }
      if (json.data === undefined) {
        throw new TrackerError('Linear API returned no data');
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchIssues(states: string[], after?: string): Promise<TrackerIssue[]> {
    const all: TrackerIssue[] = [];
    let cursor: string | undefined = after;
    do {
      const variables: Record<string, unknown> = {
        filter: {
          team: { key: { eq: this.#projectSlug } },
          state: { name: { in: states } },
        },
        first: ISSUE_PAGE_SIZE,
        ...(cursor !== undefined && { after: cursor }),
      };
      const data = await this.#graphql(ISSUES_QUERY, variables);
      if (!hasIssues(data)) {
        throw new TrackerError('Linear API: unexpected issues response shape');
      }
      all.push(...data.issues.nodes.map((n) => this.#normalize(n)));
      cursor = data.issues.pageInfo.hasNextPage
        ? (data.issues.pageInfo.endCursor ?? undefined)
        : undefined;
    } while (cursor !== undefined);
    return all;
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    const data = await this.#graphql(ISSUES_BY_IDS_QUERY, {
      filter: { id: { in: ids } },
    });
    if (!hasIssues(data)) {
      throw new TrackerError(
        'Linear API: unexpected issues-by-ids response shape',
      );
    }
    return data.issues.nodes.map((n) => this.#normalize(n));
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.#graphql(CREATE_COMMENT_MUTATION, { issueId, body });
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const data = await this.#graphql(WORKFLOW_STATES_QUERY, {
      filter: { name: { eq: stateName } },
    });
    if (!hasWorkflowStates(data)) {
      throw new TrackerError(
        'Linear API: unexpected workflow-states response shape',
      );
    }
    const state = data.workflowStates.nodes[0];
    if (!state) {
      throw new TrackerError(`Workflow state "${stateName}" not found`);
    }
    await this.#graphql(UPDATE_ISSUE_MUTATION, {
      issueId,
      stateId: state.id,
    });
  }

  async fetchViewer(): Promise<{ id: string; name: string; email: string }> {
    const data = await this.#graphql(VIEWER_QUERY);
    if (!hasViewer(data)) {
      throw new TrackerError('Linear API: unexpected viewer response shape');
    }
    return data.viewer;
  }

  #normalize(node: LinearIssueNode): TrackerIssue {
    const labels = node.labels.nodes.map((l) => l.name.toLowerCase());
    const blockedBy = node.inverseRelations.nodes
      .filter((r) => r.type === 'blocks')
      .map((r) => ({
        id: r.issue.id,
        identifier: r.issue.identifier,
        state: r.issue.state.name,
      }));
    const priority =
      typeof node.priority === 'number' ? node.priority : null;
    const assignedToWorker =
      this.#assignee !== null && node.assignee !== null
        ? node.assignee.name.toLowerCase() ===
            this.#assignee.toLowerCase() ||
          node.assignee.id === this.#assignee
        : false;
    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description,
      state: node.state.name,
      priority,
      labels,
      blockedBy,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      assignedToWorker,
      url: node.url ?? null,
      branchName: node.branchName ?? null,
      assigneeId: node.assignee?.id ?? null,
    };
  }
}

// ── LinearAdapter ─────────────────────────────────────────────────────────────

export class LinearAdapter implements Tracker {
  #client: LinearClient;
  #activeStates: string[];
  #resolvedAssignee = false;

  constructor(config: TrackerConfig) {
    this.#client = new LinearClient(
      config.endpoint ?? 'https://api.linear.app/graphql',
      config.apiKey ?? '',
      config.projectSlug ?? '',
      config.assignee ?? null,
    );
    this.#activeStates = config.activeStates ?? ['In Progress', 'Todo'];
  }

  async #ensureAssigneeResolved(): Promise<void> {
    if (this.#resolvedAssignee) return;
    this.#resolvedAssignee = true;
    if (this.#client.assignee?.toLowerCase() === 'me') {
      const viewer = await this.#client.fetchViewer();
      this.#client.assignee = viewer.id;
    }
  }

  async fetchCandidateIssues(): Promise<TrackerIssue[]> {
    await this.#ensureAssigneeResolved();
    return this.#client.fetchIssues(this.#activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]> {
    await this.#ensureAssigneeResolved();
    return this.#client.fetchIssues(states);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    await this.#ensureAssigneeResolved();
    return this.#client.fetchIssueStatesByIds(ids);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    return this.#client.createComment(issueId, body);
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    return this.#client.updateIssueState(issueId, stateName);
  }
}
