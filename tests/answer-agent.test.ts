import { describe, expect, it } from "vitest";
import { answerFromEvents, isQuestion, isStoredStateQuestion, parseAgentStream } from "@/lib/answer-agent";

describe("isQuestion", () => {
  it("sends questions to the agent", () => {
    expect(isQuestion("how many coke cans are left on the table")).toBe(true);
    expect(isQuestion("who took the last one")).toBe(true);
    expect(isQuestion("what is in the fridge")).toBe(true);
  });

  it("keeps remember, register and privacy requests in the app", () => {
    expect(isQuestion("remember this")).toBe(false);
    expect(isQuestion("register this fridge")).toBe(false);
    expect(isQuestion("please don't record that")).toBe(false);
    expect(isQuestion("this is the garage fridge")).toBe(false);
    expect(isQuestion("forget what I said")).toBe(false);
  });
});

describe("parseAgentStream", () => {
  it("joins text chunks and ignores everything else", () => {
    const body = [
      `data: {"chunk_type":"tool_call","content":"get_world_state"}`,
      `: keep-alive`,
      `data: {"chunk_type":"text","content":"Two coke cans "}`,
      `data: {"chunk_type":"text","content":"are left."}`,
      `data: {"chunk_type":"done","metadata":{"status":"completed"}}`,
      `data: {"chunk_type":"te`,
    ].join("\n");
    expect(parseAgentStream(body)).toEqual({ text: "Two coke cans are left.", suspended: false });
  });

  it("reports a suspended run", () => {
    const body = `data: {"chunk_type":"done","metadata":{"status":"suspended"}}\n`;
    expect(parseAgentStream(body)).toEqual({ text: "", suspended: true });
  });
});

describe("answerFromEvents", () => {
  it("joins model deltas and prefers the finished message", () => {
    const result = answerFromEvents([
      { type: "model.message.delta", content: "One pepsi " },
      { type: "model.message.delta", content: "is left." },
      { type: "turn.done", state: { status: "done", output: { content: "One pepsi is left." } } },
    ]);
    expect(result).toEqual({ text: "One pepsi is left.", suspended: false });
  });

  it("does not speak when the turn is waiting on a person", () => {
    expect(answerFromEvents([{ type: "turn.done", state: { status: "paused", output: null } }])).toEqual({
      text: "",
      suspended: true,
    });
  });
});

describe("isStoredStateQuestion", () => {
  it("keeps questions about the live view in the app, where the photo is", () => {
    expect(isStoredStateQuestion("what am I looking at")).toBe(false);
    expect(isStoredStateQuestion("what is this")).toBe(false);
    expect(isStoredStateQuestion("how many cans do you see")).toBe(false);
  });

  it("sends questions about remembered places to the agent", () => {
    expect(isStoredStateQuestion("how many coke cans are left on the table")).toBe(true);
    expect(isStoredStateQuestion("what should I buy")).toBe(true);
  });
});

describe("place questions", () => {
  it("keeps 'where am I' on the photo path", () => {
    expect(isStoredStateQuestion("where am I")).toBe(false);
    expect(isStoredStateQuestion("what place is this")).toBe(false);
    expect(isStoredStateQuestion("remember this place")).toBe(false);
  });
});
