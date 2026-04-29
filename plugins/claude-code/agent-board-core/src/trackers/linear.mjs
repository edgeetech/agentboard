// Linear GraphQL adapter. Ported from hatice src/linear/client.ts + adapter.ts.

import { TrackerError } from './tracker.mjs';

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

class LinearClient {
  #endpoint; #apiKey; #projectSlug; #assignee;

  constructor(endpoint, apiKey, projectSlug, assignee) {
    this.#endpoint = endpoint;
    this.#apiKey = apiKey;
    this.#projectSlug = projectSlug;
    this.#assignee = assignee;
  }

  /** @returns {string|null} */
  get assignee() { return this.#assignee; }
  set assignee(v) { this.#assignee = v; }

  async #graphql(query, variables = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.#apiKey },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new TrackerError(`Linear API HTTP ${resp.status}: ${resp.statusText}`, resp.status);
      const json = await resp.json();
      if (json.errors?.length) throw new TrackerError(`Linear GraphQL errors: ${json.errors.map(e => e.message).join('; ')}`);
      if (!json.data) throw new TrackerError('Linear API returned no data');
      return json.data;
    } finally { clearTimeout(timer); }
  }

  /** @param {string[]} states @param {string} [after] @returns {Promise<import('./tracker.mjs').TrackerIssue[]>} */
  async fetchIssues(states, after) {
    const all = [];
    let cursor = after;
    do {
      const variables = {
        filter: { team: { key: { eq: this.#projectSlug } }, state: { name: { in: states } } },
        first: ISSUE_PAGE_SIZE,
        ...(cursor && { after: cursor }),
      };
      const data = await this.#graphql(ISSUES_QUERY, variables);
      all.push(...data.issues.nodes.map(n => this.#normalize(n)));
      cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : undefined;
    } while (cursor);
    return all;
  }

  /** @param {string[]} ids */
  async fetchIssueStatesByIds(ids) {
    const data = await this.#graphql(ISSUES_BY_IDS_QUERY, { filter: { id: { in: ids } } });
    return data.issues.nodes.map(n => this.#normalize(n));
  }

  async createComment(issueId, body) { await this.#graphql(CREATE_COMMENT_MUTATION, { issueId, body }); }

  async updateIssueState(issueId, stateName) {
    const data = await this.#graphql(WORKFLOW_STATES_QUERY, { filter: { name: { eq: stateName } } });
    const state = data.workflowStates.nodes[0];
    if (!state) throw new TrackerError(`Workflow state "${stateName}" not found`);
    await this.#graphql(UPDATE_ISSUE_MUTATION, { issueId, stateId: state.id });
  }

  async fetchViewer() {
    const data = await this.#graphql(VIEWER_QUERY);
    return data.viewer;
  }

  /** @param {object} node @returns {import('./tracker.mjs').TrackerIssue} */
  #normalize(node) {
    const labels = node.labels.nodes.map(l => l.name.toLowerCase());
    const blockedBy = node.inverseRelations.nodes
      .filter(r => r.type === 'blocks')
      .map(r => ({ id: r.issue.id, identifier: r.issue.identifier, state: r.issue.state.name }));
    const priority = typeof node.priority === 'number' ? node.priority : null;
    const assignedToWorker = this.#assignee && node.assignee
      ? node.assignee.name.toLowerCase() === this.#assignee.toLowerCase() || node.assignee.id === this.#assignee
      : false;
    return {
      id: node.id, identifier: node.identifier, title: node.title,
      description: node.description, state: node.state.name,
      priority, labels, blockedBy,
      createdAt: node.createdAt, updatedAt: node.updatedAt,
      assignedToWorker, url: node.url ?? null, branchName: node.branchName ?? null,
      assigneeId: node.assignee?.id ?? null,
    };
  }
}

export class LinearAdapter {
  #client; #activeStates; #resolvedAssignee = false;

  /** @param {import('./tracker.mjs').TrackerConfig} config */
  constructor(config) {
    this.#client = new LinearClient(
      config.endpoint ?? 'https://api.linear.app/graphql',
      config.apiKey ?? '',
      config.projectSlug ?? '',
      config.assignee ?? null,
    );
    this.#activeStates = config.activeStates ?? ['In Progress', 'Todo'];
  }

  async #ensureAssigneeResolved() {
    if (this.#resolvedAssignee) return;
    this.#resolvedAssignee = true;
    if (this.#client.assignee?.toLowerCase() === 'me') {
      const viewer = await this.#client.fetchViewer();
      this.#client.assignee = viewer.id;
    }
  }

  async fetchCandidateIssues() { await this.#ensureAssigneeResolved(); return this.#client.fetchIssues(this.#activeStates); }
  async fetchIssuesByStates(states) { await this.#ensureAssigneeResolved(); return this.#client.fetchIssues(states); }
  async fetchIssueStatesByIds(ids) { await this.#ensureAssigneeResolved(); return this.#client.fetchIssueStatesByIds(ids); }
  async createComment(issueId, body) { return this.#client.createComment(issueId, body); }
  async updateIssueState(issueId, stateName) { return this.#client.updateIssueState(issueId, stateName); }
}
