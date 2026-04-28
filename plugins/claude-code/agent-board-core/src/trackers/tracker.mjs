// Tracker interface definition (JS duck typing with JSDoc)

/**
 * @typedef {Object} BlockerRef
 * @property {string} id
 * @property {string} identifier
 * @property {string} state
 */

/**
 * @typedef {Object} TrackerIssue
 * @property {string} id
 * @property {string} identifier
 * @property {string} title
 * @property {string|null} description
 * @property {string} state
 * @property {number|null} priority
 * @property {string[]} labels
 * @property {BlockerRef[]} blockedBy
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} assignedToWorker
 * @property {string|null} url
 * @property {string|null} branchName
 * @property {string|null} assigneeId
 */

/**
 * @typedef {Object} TrackerConfig
 * @property {'linear'|'github'|'gitlab'|'memory'} kind
 * @property {string} [endpoint]
 * @property {string} [apiKey]
 * @property {string} [projectSlug]
 * @property {string|null} [assignee]
 * @property {string[]} [activeStates]
 */

/**
 * Tracker duck-type interface. Implementations must provide these methods.
 *
 * @interface Tracker
 * @method fetchCandidateIssues - fetch all active/open issues
 * @method fetchIssuesByStates  - fetch issues matching given state names
 * @method fetchIssueStatesByIds - fetch issues by IDs (for status reconciliation)
 * @method createComment        - post a comment on an issue
 * @method updateIssueState     - change issue state (e.g. close/reopen)
 */

export class TrackerError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = 'TrackerError';
    this.status = status ?? null;
  }
}
