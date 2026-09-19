import { describe, expect, it } from "vitest";

import {
  allowedPrevStatuses,
  canTransition,
  transitions,
  type TaskStatus,
} from "../src/index.ts";

describe("engine task workflow", () => {
  describe("WF1", () => {
    it("allows PM to start worker execution", () => {
      expect(
        canTransition("WF1", "todo", "agent_working", "worker", "pm").ok,
      ).toBe(true);
    });

    it("blocks worker from starting a todo task directly", () => {
      expect(
        canTransition("WF1", "todo", "agent_working", "worker", "worker").ok,
      ).toBe(false);
    });

    it("allows worker to submit for review", () => {
      expect(
        canTransition(
          "WF1",
          "agent_working",
          "agent_review",
          "reviewer",
          "worker",
        ).ok,
      ).toBe(true);
    });

    it("allows reviewer to submit for human approval", () => {
      expect(
        canTransition(
          "WF1",
          "agent_review",
          "human_approval",
          "human",
          "reviewer",
        ).ok,
      ).toBe(true);
    });

    it("blocks wrong assignee for human approval", () => {
      expect(
        canTransition(
          "WF1",
          "agent_review",
          "human_approval",
          "worker",
          "reviewer",
        ).ok,
      ).toBe(false);
    });

    it("allows human approval to done", () => {
      expect(
        canTransition("WF1", "human_approval", "done", "human", "human").ok,
      ).toBe(true);
    });
  });

  describe("WF2", () => {
    it("allows worker to submit directly for human approval", () => {
      expect(
        canTransition(
          "WF2",
          "agent_working",
          "human_approval",
          "human",
          "worker",
        ).ok,
      ).toBe(true);
    });

    it("does not allow reviewer state in the normal path", () => {
      expect(
        canTransition(
          "WF2",
          "agent_working",
          "agent_review",
          "reviewer",
          "worker",
        ).ok,
      ).toBe(false);
    });
  });

  it("returns previous statuses for a target state", () => {
    const previous = allowedPrevStatuses("WF1", "agent_working");
    expect(previous).toContain("todo");
    expect(previous).toContain("agent_working");
  });

  it("returns no previous statuses for an unknown target", () => {
    expect(allowedPrevStatuses("WF1", "missing" as TaskStatus)).toEqual([]);
  });

  it("keeps WF1 larger than WF2 because it includes review", () => {
    expect(transitions("WF1").length).toBeGreaterThan(
      transitions("WF2").length,
    );
  });
});
