import { describe, it, expect } from 'vitest';
import { canTransition, transitions, allowedPrevStatuses } from '../src/state-machine.mjs';

describe('StateMachine (CAS transitions)', () => {
  // WF1 tests
  describe('WF1', () => {
    it('valid: pm can move todo → agent_working with worker assignee', () => {
      const result = canTransition('WF1', 'todo', 'agent_working', 'worker', 'pm');
      expect(result.ok).toBe(true);
    });

    it('invalid: worker cannot move todo → agent_working (pm required)', () => {
      const result = canTransition('WF1', 'todo', 'agent_working', 'worker', 'worker');
      expect(result.ok).toBe(false);
    });

    it('valid: worker can move agent_working → agent_review with reviewer assignee', () => {
      const result = canTransition('WF1', 'agent_working', 'agent_review', 'reviewer', 'worker');
      expect(result.ok).toBe(true);
    });

    it('invalid: pm cannot move agent_working → agent_review', () => {
      const result = canTransition('WF1', 'agent_working', 'agent_review', 'reviewer', 'pm');
      expect(result.ok).toBe(false);
    });

    it('valid: reviewer can move agent_review → human_approval', () => {
      const result = canTransition('WF1', 'agent_review', 'human_approval', 'human', 'reviewer');
      expect(result.ok).toBe(true);
    });

    it('invalid: wrong assignee for agent_review → human_approval', () => {
      const result = canTransition('WF1', 'agent_review', 'human_approval', 'worker', 'reviewer');
      expect(result.ok).toBe(false);
    });

    it('valid: human can move human_approval → done', () => {
      const result = canTransition('WF1', 'human_approval', 'done', 'human', 'human');
      expect(result.ok).toBe(true);
    });

    it('invalid: no rule for done → todo', () => {
      const result = canTransition('WF1', 'done', 'todo', 'worker', 'pm');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('no rule');
    });
  });

  // WF2 tests
  describe('WF2', () => {
    it('valid: pm starts task in WF2', () => {
      const result = canTransition('WF2', 'todo', 'agent_working', 'worker', 'pm');
      expect(result.ok).toBe(true);
    });

    it('valid: worker submits for human approval in WF2', () => {
      const result = canTransition('WF2', 'agent_working', 'human_approval', 'human', 'worker');
      expect(result.ok).toBe(true);
    });

    it('invalid: reviewer role does not exist in WF2 transitions', () => {
      // WF2 has no agent_review state
      const result = canTransition('WF2', 'agent_working', 'agent_review', 'reviewer', 'worker');
      expect(result.ok).toBe(false);
    });
  });

  describe('allowedPrevStatuses', () => {
    it('returns correct previous statuses for WF1 → agent_working', () => {
      const prev = allowedPrevStatuses('WF1', 'agent_working');
      expect(prev).toContain('todo');
      expect(prev).toContain('agent_working'); // self-loop
    });

    it('returns empty for unknown target status', () => {
      const prev = allowedPrevStatuses('WF1', 'nonexistent');
      expect(prev).toEqual([]);
    });
  });

  describe('transitions', () => {
    it('WF1 has more transitions than WF2 (includes agent_review)', () => {
      const wf1 = transitions('WF1');
      const wf2 = transitions('WF2');
      expect(wf1.length).toBeGreaterThan(wf2.length);
    });

    it('WF1 includes agent_review state', () => {
      const wf1 = transitions('WF1');
      expect(wf1.some(t => t.from === 'agent_review' || t.to === 'agent_review')).toBe(true);
    });
  });
});
