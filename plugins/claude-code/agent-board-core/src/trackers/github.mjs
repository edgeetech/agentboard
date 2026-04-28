// GitHub REST+GraphQL adapter. Ported from hatice src/github/client.ts + adapter.ts.

import { TrackerError } from './tracker.mjs';

const PAGE_SIZE = 50;

const PRIORITY_MAP = { 'priority: urgent': 0, 'priority: high': 1, 'priority: medium': 2, 'priority: low': 3 };

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

class GitHubClient {
  #apiToken; #owner; #repo; #assignee;

  constructor(apiToken, owner, repo, assignee) {
    this.#apiToken = apiToken;
    this.#owner = owner;
    this.#repo = repo;
    this.#assignee = assignee;
  }

  async #graphql(query, variables) {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) throw new TrackerError(`GitHub API error: ${resp.status} ${resp.statusText}`, resp.status);
    const json = await resp.json();
    if (json.errors?.length) throw new TrackerError(`GitHub GraphQL error: ${json.errors.map(e => e.message).join(', ')}`);
    return json.data;
  }

  async #rest(method, path, body) {
    const resp = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiToken}`, 'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) throw new TrackerError(`GitHub REST error: ${resp.status} ${resp.statusText}`, resp.status);
    const text = await resp.text();
    return text ? JSON.parse(text) : undefined;
  }

  /** @param {object} node @returns {import('./tracker.mjs').TrackerIssue} */
  #normalize(node) {
    const identifier = `${this.#owner}/${this.#repo}#${node.number}`;
    let state = node.state === 'OPEN' ? 'Open' : 'Closed';
    const pi = node.projectItems?.nodes?.[0];
    if (pi?.fieldValueByName?.name) state = pi.fieldValueByName.name;
    const labels = node.labels.nodes.map(l => l.name.toLowerCase());
    let priority = null;
    for (const l of labels) { if (l in PRIORITY_MAP) { priority = PRIORITY_MAP[l]; break; } }
    const blockedBy = node.trackedInIssues.nodes.map(r => ({
      id: r.id, identifier: `${this.#owner}/${this.#repo}#${r.number}`, state: r.state,
    }));
    const assignedToWorker = this.#assignee != null
      ? node.assignees.nodes.some(a => a.login === this.#assignee) : false;
    const assigneeId = node.assignees.nodes[0]?.id ?? null;
    return { id: node.id, identifier, title: node.title, description: node.body, state, priority, labels, blockedBy,
      createdAt: node.createdAt, updatedAt: node.updatedAt, assignedToWorker, url: node.url, branchName: null, assigneeId };
  }

  #mapStates(states) {
    const out = new Set();
    for (const s of states) {
      const l = s.toLowerCase();
      if (l === 'closed' || l === 'done' || l === 'cancelled') out.add('CLOSED'); else out.add('OPEN');
    }
    return [...out];
  }

  async fetchIssues(states, after) {
    const ghStates = this.#mapStates(states);
    const all = [];
    let cursor = after ?? null;
    let hasNext = true;
    while (hasNext) {
      const data = await this.#graphql(ISSUES_QUERY, {
        owner: this.#owner, repo: this.#repo, states: ghStates, first: PAGE_SIZE, after: cursor,
      });
      const conn = data.repository.issues;
      all.push(...conn.nodes.map(n => this.#normalize(n)));
      hasNext = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor ?? null;
    }
    return all;
  }

  async fetchIssueStatesByIds(ids) {
    if (!ids.length) return [];
    const data = await this.#graphql(ISSUES_BY_IDS_QUERY, { ids });
    return data.nodes.filter(Boolean).map(n => this.#normalize(n));
  }

  async createComment(issueId, body) {
    const num = issueId.includes('#') ? issueId.split('#').pop() : issueId;
    await this.#rest('POST', `/repos/${this.#owner}/${this.#repo}/issues/${num}/comments`, { body });
  }

  async updateIssueState(issueId, stateName) {
    const num = issueId.includes('#') ? issueId.split('#').pop() : issueId;
    const state = stateName.toLowerCase() === 'closed' ? 'closed' : 'open';
    await this.#rest('PATCH', `/repos/${this.#owner}/${this.#repo}/issues/${num}`, { state });
  }
}

export class GitHubAdapter {
  #client; #activeStates;

  /** @param {import('./tracker.mjs').TrackerConfig} config */
  constructor(config) {
    const parts = (config.projectSlug ?? '').split('/');
    if (parts.length !== 2) throw new Error('GitHub projectSlug must be "owner/repo"');
    const [owner, repo] = parts;
    this.#client = new GitHubClient(config.apiKey ?? '', owner, repo, config.assignee ?? null);
    this.#activeStates = config.activeStates ?? ['Open'];
  }

  async fetchCandidateIssues() { return this.#client.fetchIssues(this.#activeStates); }
  async fetchIssuesByStates(states) { return this.#client.fetchIssues(states); }
  async fetchIssueStatesByIds(ids) { return this.#client.fetchIssueStatesByIds(ids); }
  async createComment(issueId, body) { return this.#client.createComment(issueId, body); }
  async updateIssueState(issueId, stateName) { return this.#client.updateIssueState(issueId, stateName); }
}
