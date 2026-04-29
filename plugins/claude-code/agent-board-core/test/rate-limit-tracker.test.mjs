import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimitTracker } from '../src/rate-limit-tracker.mjs';

describe('RateLimitTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  it('new tracker: isLimited returns false', () => {
    expect(tracker.isLimited('api')).toBe(false);
  });

  it('after recordLimit with no retryAfterMs: isLimited returns true indefinitely', () => {
    tracker.recordLimit('api');
    expect(tracker.isLimited('api')).toBe(true);
  });

  it('after recordLimit with future retryAfterMs: isLimited returns true', () => {
    tracker.recordLimit('api', 60_000);
    expect(tracker.isLimited('api')).toBe(true);
  });

  it('after recordLimit with past expiry: isLimited returns false', () => {
    tracker.recordLimit('api', 0); // limitedUntil = now + 0
    // Wait a tick so Date.now() > limitedUntil
    expect(tracker.isLimited('api')).toBe(false);
  });

  it('getInfo returns positive retryAfterMs when limited', () => {
    tracker.recordLimit('api', 5_000);
    const info = tracker.getInfo('api');
    expect(info.isLimited).toBe(true);
    expect(info.retryAfterMs).toBeGreaterThan(0);
  });

  it('getInfo limitCount increments on repeated recordLimit', () => {
    tracker.recordLimit('api', 1_000);
    tracker.recordLimit('api', 1_000);
    expect(tracker.getInfo('api').limitCount).toBe(2);
  });

  it('recordSuccess clears the limit', () => {
    tracker.recordLimit('api', 60_000);
    tracker.recordSuccess('api');
    expect(tracker.isLimited('api')).toBe(false);
  });

  it('reset removes the entry', () => {
    tracker.recordLimit('api', 60_000);
    tracker.reset('api');
    expect(tracker.isLimited('api')).toBe(false);
    expect(tracker.getInfo('api').limitCount).toBe(0);
  });

  it('getAllLimits returns all tracked sources', () => {
    tracker.recordLimit('github', 1_000);
    tracker.recordLimit('linear', 2_000);
    const all = tracker.getAllLimits();
    expect(all.map(i => i.source)).toContain('github');
    expect(all.map(i => i.source)).toContain('linear');
  });

  it('unknown source: getInfo returns safe defaults', () => {
    const info = tracker.getInfo('nonexistent');
    expect(info.isLimited).toBe(false);
    expect(info.limitCount).toBe(0);
    expect(info.retryAfterMs).toBeNull();
  });
});
