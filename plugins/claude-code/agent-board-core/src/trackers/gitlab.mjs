// GitLab Issues REST tracker adapter. Supports CE and EE (self-hosted).
// projectSlug format: "namespace/project" or "group/subgroup/project"

const PRIORITY_MAP = {
  critical: 1, high: 2, medium: 3, low: 4,
  'severity::1': 1, 'severity::2': 2, 'severity::3': 3, 'severity::4': 4,
};

class GitLabClient {
  constructor(endpoint, token, projectSlug, assignee) {
    this.endpoint = (endpoint || 'https://gitlab.com').replace(/\/$/, '');
    this.token = token;
    this.projectSlug = encodeURIComponent(projectSlug);
    this.assignee = assignee || null;
  }

  get _headers() {
    return { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' };
  }

  async request(path, options = {}) {
    const url = `${this.endpoint}/api/v4${path}`;
    const res = await fetch(url, { ...options, headers: { ...this._headers, ...options.headers } });
    if (res.status === 429) {
      const err = new Error('GitLab rate limited');
      err.status = 429;
      const retryAfter = res.headers.get('retry-after') || res.headers.get('ratelimit-reset');
      if (retryAfter) err.retryAfterMs = (parseInt(retryAfter, 10) - Math.floor(Date.now() / 1000)) * 1000;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`GitLab HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async fetchIssues(states) {
    const glState = states.some(s => s.toLowerCase().includes('clos')) ? 'closed' : 'opened';
    const all = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        state: glState, per_page: '100', page: String(page),
        ...(this.assignee ? { assignee_username: this.assignee } : {}),
      });
      const issues = await this.request(`/projects/${this.projectSlug}/issues?${params}`);
      if (!Array.isArray(issues) || issues.length === 0) break;
      all.push(...issues.map(i => this._normalize(i)));
      if (issues.length < 100) break;
      page++;
    }
    return all;
  }

  async fetchIssuesByIds(ids) {
    const results = await Promise.allSettled(
      ids.map(id => this.request(`/projects/${this.projectSlug}/issues/${id}`))
    );
    return results.filter(r => r.status === 'fulfilled').map(r => this._normalize(r.value));
  }

  async createComment(issueIid, body) {
    await this.request(`/projects/${this.projectSlug}/issues/${issueIid}/notes`, {
      method: 'POST', body: JSON.stringify({ body }),
    });
  }

  async updateIssueState(issueIid, stateName) {
    const state_event = stateName.toLowerCase().includes('clos') ? 'close' : 'reopen';
    await this.request(`/projects/${this.projectSlug}/issues/${issueIid}`, {
      method: 'PUT', body: JSON.stringify({ state_event }),
    });
  }

  _normalize(issue) {
    const labels = (issue.labels || []).map(l => l.toLowerCase());
    // Derive priority from labels (priority:: takes precedence over severity::)
    let priority = null;
    for (const label of labels) {
      if (PRIORITY_MAP[label] !== undefined) {
        if (label.startsWith('priority::') || !label.startsWith('severity::')) {
          priority = PRIORITY_MAP[label];
          if (label.startsWith('priority::')) break;
        } else if (priority === null) {
          priority = PRIORITY_MAP[label];
        }
      }
    }
    return {
      id: String(issue.iid),
      identifier: `${decodeURIComponent(this.projectSlug)}#${issue.iid}`,
      title: issue.title,
      description: issue.description ?? null,
      state: issue.state,
      priority,
      labels,
      blockedBy: [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      assignedToWorker: this.assignee
        ? issue.assignees?.some(a => a.username === this.assignee) ?? false
        : false,
      url: issue.web_url ?? null,
      branchName: null,
      assigneeId: issue.assignees?.[0]?.username ?? null,
    };
  }
}

export class GitLabAdapter {
  constructor(config) {
    this.client = new GitLabClient(
      config.endpoint, config.apiKey, config.projectSlug, config.assignee
    );
    this.activeStates = config.activeStates;
  }

  async fetchCandidateIssues() { return this.client.fetchIssues(this.activeStates); }
  async fetchIssuesByStates(states) { return this.client.fetchIssues(states); }
  async fetchIssuesByIds(ids) { return this.client.fetchIssuesByIds(ids); }
  async createComment(issueId, body) { return this.client.createComment(issueId, body); }
  async updateIssueState(issueId, state) { return this.client.updateIssueState(issueId, state); }
}
