// GitHub Issues REST+GraphQL tracker adapter.
// projectSlug format: "owner/repo"

const GH_API = 'https://api.github.com';
const GH_GRAPHQL = 'https://api.github.com/graphql';

class GitHubClient {
  constructor(token, owner, repo, assignee) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.assignee = assignee || null;
  }

  get _headers() {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async rest(path, options = {}) {
    const url = `${GH_API}${path}`;
    const res = await fetch(url, { ...options, headers: { ...this._headers, ...options.headers } });
    if (res.status === 429) {
      const err = new Error(`GitHub rate limited`);
      err.status = 429;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) err.retryAfterMs = parseInt(retryAfter, 10) * 1000;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`GitHub HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async graphql(query, variables = {}) {
    const res = await fetch(GH_GRAPHQL, {
      method: 'POST',
      headers: { ...this._headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const err = new Error(`GitHub GraphQL HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    if (json.errors?.length) throw new Error(`GitHub GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
    return json.data;
  }

  async fetchIssues(states) {
    // states: ['open'] or ['closed']
    // GitHub issue states are 'open' or 'closed' only
    const ghState = states.some(s => s.toLowerCase().includes('clos')) ? 'closed'
      : states.some(s => s.toLowerCase() === 'open') ? 'open' : 'open';

    const all = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        state: ghState, per_page: '100', page: String(page),
        ...(this.assignee ? { assignee: this.assignee } : {}),
      });
      const issues = await this.rest(`/repos/${this.owner}/${this.repo}/issues?${params}`);
      if (!Array.isArray(issues) || issues.length === 0) break;
      // Filter out PRs (GitHub returns PRs in issues endpoint)
      all.push(...issues.filter(i => !i.pull_request).map(i => this._normalize(i)));
      if (issues.length < 100) break;
      page++;
    }
    return all;
  }

  async fetchIssuesByIds(ids) {
    // ids are issue numbers as strings
    const results = await Promise.allSettled(
      ids.map(id => this.rest(`/repos/${this.owner}/${this.repo}/issues/${id}`))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => this._normalize(r.value));
  }

  async createComment(issueNumber, body) {
    await this.rest(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }

  async updateIssueState(issueNumber, stateName) {
    const state = stateName.toLowerCase().includes('clos') ? 'closed' : 'open';
    await this.rest(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  }

  _normalize(issue) {
    const labels = (issue.labels || []).map(l => (l.name || '').toLowerCase());
    return {
      id: String(issue.number),
      identifier: `${this.owner}/${this.repo}#${issue.number}`,
      title: issue.title,
      description: issue.body ?? null,
      state: issue.state,
      priority: null,
      labels,
      blockedBy: [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      assignedToWorker: this.assignee
        ? (issue.assignee?.login === this.assignee || issue.assignee?.id === this.assignee)
        : false,
      url: issue.html_url ?? null,
      branchName: null,
      assigneeId: issue.assignee?.login ?? null,
    };
  }
}

export class GitHubAdapter {
  constructor(config) {
    const parts = config.projectSlug.split('/');
    if (parts.length !== 2) throw new Error('GitHub projectSlug must be "owner/repo"');
    const [owner, repo] = parts;
    this.client = new GitHubClient(config.apiKey, owner, repo, config.assignee);
    this.activeStates = config.activeStates;
  }

  async fetchCandidateIssues() { return this.client.fetchIssues(this.activeStates); }
  async fetchIssuesByStates(states) { return this.client.fetchIssues(states); }
  async fetchIssuesByIds(ids) { return this.client.fetchIssuesByIds(ids); }
  async createComment(issueId, body) { return this.client.createComment(issueId, body); }
  async updateIssueState(issueId, state) { return this.client.updateIssueState(issueId, state); }
}
