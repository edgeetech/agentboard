// GitLab REST adapter. Ported from hatice src/gitlab/client.ts + adapter.ts.

import { TrackerError } from './tracker.mjs';

const PAGE_SIZE = 100;

const SEVERITY_MAP = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_MAP = { 'priority::urgent': 0, 'priority::high': 1, 'priority::medium': 2, 'priority::low': 3 };

class GitLabClient {
  #baseUrl; #apiToken; #projectPath; #assignee;

  constructor(endpoint, apiToken, projectPath, assignee) {
    this.#baseUrl = (endpoint ?? 'https://gitlab.com').replace(/\/+$/, '');
    this.#apiToken = apiToken;
    this.#projectPath = projectPath;
    this.#assignee = assignee;
  }

  #encodedProject() { return encodeURIComponent(this.#projectPath); }

  async #request(method, path, body) {
    const resp = await fetch(`${this.#baseUrl}/api/v4${path}`, {
      method,
      headers: { 'PRIVATE-TOKEN': this.#apiToken, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) throw new TrackerError(`GitLab API error: ${resp.status} ${resp.statusText}`, resp.status);
    const text = await resp.text();
    return text ? JSON.parse(text) : undefined;
  }

  /** @param {object} issue @returns {import('./tracker.mjs').TrackerIssue} */
  #normalize(issue) {
    const identifier = `${this.#projectPath}#${issue.iid}`;
    const state = issue.state === 'opened' ? 'Open' : 'Closed';
    const labels = issue.labels.map(l => l.toLowerCase());
    let priority = null;
    for (const l of labels) { if (l in PRIORITY_MAP) { priority = PRIORITY_MAP[l]; break; } }
    if (priority === null) {
      const sev = issue.severity?.toLowerCase();
      if (sev && sev !== 'unknown' && sev in SEVERITY_MAP) priority = SEVERITY_MAP[sev];
    }
    const assignedToWorker = this.#assignee != null
      ? (issue.assignees ?? []).some(a => a.username === this.#assignee) : false;
    const assigneeId = issue.assignees?.[0] ? String(issue.assignees[0].id) : null;
    return {
      id: identifier, identifier, title: issue.title, description: issue.description,
      state, priority, labels, blockedBy: [],
      createdAt: issue.created_at, updatedAt: issue.updated_at,
      assignedToWorker, url: issue.web_url, branchName: null, assigneeId,
    };
  }

  #mapStates(states) {
    for (const s of states) {
      const l = s.toLowerCase();
      if (l === 'closed' || l === 'done' || l === 'cancelled') return 'closed';
    }
    return 'opened';
  }

  async fetchIssues(states) {
    const glState = this.#mapStates(states);
    const all = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams({
        state: glState, per_page: String(PAGE_SIZE), page: String(page),
        order_by: 'created_at', sort: 'asc',
      });
      if (this.#assignee) params.set('assignee_username', this.#assignee);
      const issues = await this.#request('GET', `/projects/${this.#encodedProject()}/issues?${params}`);
      all.push(...issues.map(i => this.#normalize(i)));
      hasMore = issues.length === PAGE_SIZE;
      page++;
    }
    return all;
  }

  async fetchIssueStatesByIds(ids) {
    if (!ids.length) return [];
    const results = [];
    for (const id of ids) {
      const iid = id.includes('#') ? id.split('#').pop() : id;
      const issue = await this.#request('GET', `/projects/${this.#encodedProject()}/issues/${iid}`);
      results.push(this.#normalize(issue));
    }
    return results;
  }

  async createComment(issueId, body) {
    const iid = issueId.includes('#') ? issueId.split('#').pop() : issueId;
    await this.#request('POST', `/projects/${this.#encodedProject()}/issues/${iid}/notes`, { body });
  }

  async updateIssueState(issueId, stateName) {
    const iid = issueId.includes('#') ? issueId.split('#').pop() : issueId;
    const l = stateName.toLowerCase();
    const state_event = (l === 'closed' || l === 'done') ? 'close' : 'reopen';
    await this.#request('PUT', `/projects/${this.#encodedProject()}/issues/${iid}`, { state_event });
  }
}

export class GitLabAdapter {
  #client; #activeStates;

  /** @param {import('./tracker.mjs').TrackerConfig} config */
  constructor(config) {
    this.#client = new GitLabClient(
      config.endpoint ?? 'https://gitlab.com',
      config.apiKey ?? '',
      config.projectSlug ?? '',
      config.assignee ?? null,
    );
    this.#activeStates = config.activeStates ?? ['Open'];
  }

  async fetchCandidateIssues() { return this.#client.fetchIssues(this.#activeStates); }
  async fetchIssuesByStates(states) { return this.#client.fetchIssues(states); }
  async fetchIssueStatesByIds(ids) { return this.#client.fetchIssueStatesByIds(ids); }
  async createComment(issueId, body) { return this.#client.createComment(issueId, body); }
  async updateIssueState(issueId, stateName) { return this.#client.updateIssueState(issueId, stateName); }
}
