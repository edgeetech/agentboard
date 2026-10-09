// In-memory Tracker implementation for testing/development.
// Ported from hatice src/tracker.ts (MemoryTracker).

import type { Tracker, TrackerIssue } from './tracker.ts';

interface StoredComment {
  issueId: string;
  body: string;
  createdAt: Date;
}

export class MemoryTracker implements Tracker {
  #issues: Map<string, TrackerIssue>;
  #comments: StoredComment[] = [];

  constructor(initialIssues: TrackerIssue[] = []) {
    this.#issues = new Map(initialIssues.map((i) => [i.id, i]));
  }

  fetchCandidateIssues(): Promise<TrackerIssue[]> {
    return Promise.resolve([...this.#issues.values()]);
  }

  fetchIssuesByStates(states: string[]): Promise<TrackerIssue[]> {
    const stateSet = new Set(states);
    return Promise.resolve(
      [...this.#issues.values()].filter((i) => stateSet.has(i.state)),
    );
  }

  fetchIssueStatesByIds(ids: string[]): Promise<TrackerIssue[]> {
    const idSet = new Set(ids);
    return Promise.resolve(
      [...this.#issues.values()].filter((i) => idSet.has(i.id)),
    );
  }

  createComment(issueId: string, body: string): Promise<void> {
    this.#comments.push({ issueId, body, createdAt: new Date() });
    return Promise.resolve();
  }

  updateIssueState(issueId: string, stateName: string): Promise<void> {
    const issue = this.#issues.get(issueId);
    if (issue) issue.state = stateName;
    return Promise.resolve();
  }

  // Test helpers
  addIssue(issue: TrackerIssue): void {
    this.#issues.set(issue.id, issue);
  }

  removeIssue(issueId: string): boolean {
    return this.#issues.delete(issueId);
  }

  getComments(): StoredComment[] {
    return [...this.#comments];
  }
}
