// Linear GraphQL tracker adapter.
// Fetches issues, creates comments, updates state via Linear's GraphQL API.

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
  constructor(endpoint, apiKey, projectSlug, assignee) {
    this.endpoint = endpoint || 'https://api.linear.app/graphql';
    this.apiKey = apiKey;
    this.projectSlug = projectSlug;
    this.assignee = assignee || null;
  }

  async graphql(query, variables = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.apiKey },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`Linear HTTP ${res.status}: ${res.statusText}`);
        err.status = res.status;
        throw err;
      }
      const json = await res.json();
      if (json.errors?.length) throw new Error(`Linear GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchIssues(states, after) {
    const all = [];
    let cursor = after;
    do {
      const variables = {
        filter: { team: { key: { eq: this.projectSlug } }, state: { name: { in: states } } },
        first: ISSUE_PAGE_SIZE,
      };
      if (cursor) variables.after = cursor;
      const data = await this.graphql(ISSUES_QUERY, variables);
      all.push(...data.issues.nodes.map(n => this._normalize(n)));
      cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
    } while (cursor);
    return all;
  }

  async fetchIssuesByIds(ids) {
    const data = await this.graphql(ISSUES_BY_IDS_QUERY, { filter: { id: { in: ids } } });
    return data.issues.nodes.map(n => this._normalize(n));
  }

  async createComment(issueId, body) {
    await this.graphql(CREATE_COMMENT_MUTATION, { issueId, body });
  }

  async updateIssueState(issueId, stateName) {
    const data = await this.graphql(WORKFLOW_STATES_QUERY, { filter: { name: { eq: stateName } } });
    const state = data.workflowStates.nodes[0];
    if (!state) throw new Error(`Linear: state "${stateName}" not found`);
    await this.graphql(UPDATE_ISSUE_MUTATION, { issueId, stateId: state.id });
  }

  async fetchViewer() {
    const data = await this.graphql(VIEWER_QUERY);
    return data.viewer;
  }

  _normalize(node) {
    const labels = node.labels.nodes.map(l => l.name.toLowerCase());
    const blockedBy = node.inverseRelations.nodes
      .filter(r => r.type === 'blocks')
      .map(r => ({ id: r.issue.id, identifier: r.issue.identifier, state: r.issue.state.name }));
    let assignedToWorker = false;
    if (this.assignee && node.assignee) {
      assignedToWorker = node.assignee.name.toLowerCase() === this.assignee.toLowerCase()
        || node.assignee.id === this.assignee;
    }
    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description ?? null,
      state: node.state.name,
      priority: typeof node.priority === 'number' ? node.priority : null,
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

export class LinearAdapter {
  constructor(config) {
    this.client = new LinearClient(
      config.endpoint, config.apiKey, config.projectSlug, config.assignee
    );
    this.activeStates = config.activeStates;
    this._assigneeResolved = false;
  }

  async _ensureAssignee() {
    if (this._assigneeResolved) return;
    this._assigneeResolved = true;
    if (this.client.assignee?.toLowerCase() === 'me') {
      const viewer = await this.client.fetchViewer();
      this.client.assignee = viewer.id;
    }
  }

  async fetchCandidateIssues() { await this._ensureAssignee(); return this.client.fetchIssues(this.activeStates); }
  async fetchIssuesByStates(states) { await this._ensureAssignee(); return this.client.fetchIssues(states); }
  async fetchIssuesByIds(ids) { return this.client.fetchIssuesByIds(ids); }
  async createComment(issueId, body) { return this.client.createComment(issueId, body); }
  async updateIssueState(issueId, state) { return this.client.updateIssueState(issueId, state); }
}
