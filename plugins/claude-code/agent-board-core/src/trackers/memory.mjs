// In-memory Tracker implementation for testing/development.
// Ported from hatice src/tracker.ts (MemoryTracker).

/**
 * @typedef {import('./tracker.mjs').TrackerIssue} TrackerIssue
 */

export class MemoryTracker {
  /** @type {Map<string, TrackerIssue>} */
  #issues;
  /** @type {Array<{issueId:string, body:string, createdAt:Date}>} */
  #comments = [];

  /** @param {TrackerIssue[]} [initialIssues] */
  constructor(initialIssues = []) {
    this.#issues = new Map(initialIssues.map(i => [i.id, i]));
  }

  async fetchCandidateIssues() {
    return [...this.#issues.values()];
  }

  /** @param {string[]} states */
  async fetchIssuesByStates(states) {
    const stateSet = new Set(states);
    return [...this.#issues.values()].filter(i => stateSet.has(i.state));
  }

  /** @param {string[]} ids */
  async fetchIssueStatesByIds(ids) {
    const idSet = new Set(ids);
    return [...this.#issues.values()].filter(i => idSet.has(i.id));
  }

  /** @param {string} issueId @param {string} body */
  async createComment(issueId, body) {
    this.#comments.push({ issueId, body, createdAt: new Date() });
  }

  /** @param {string} issueId @param {string} stateName */
  async updateIssueState(issueId, stateName) {
    const issue = this.#issues.get(issueId);
    if (issue) issue.state = stateName;
  }

  // Test helpers
  /** @param {TrackerIssue} issue */
  addIssue(issue) { this.#issues.set(issue.id, issue); }
  /** @param {string} issueId @returns {boolean} */
  removeIssue(issueId) { return this.#issues.delete(issueId); }
  getComments() { return [...this.#comments]; }
}
