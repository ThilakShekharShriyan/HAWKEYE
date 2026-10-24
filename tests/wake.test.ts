import { describe, expect, it } from "vitest";
import { matchWake, WAKE_PHRASE } from "../lib/wake";

describe("wake phrase", () => {
  it("is Hey Hawkeye", () => {
    expect(WAKE_PHRASE).toBe("Hey Hawkeye");
  });

  it.each([
    ["Hey Hawkeye, how many eggs are left?", "how many eggs are left?"],
    ["hey hawkeye remember this fridge", "remember this fridge"],
    ["Okay Hawk Eye. who took the last coke", "who took the last coke"],
    ["Hi hawkeyes what should I buy", "what should I buy"],
    ["hey hawk-eye, remember this", "remember this"],
  ])("wakes on %s", (text, rest) => {
    expect(matchWake(text)).toEqual({ woke: true, rest });
  });

  it("still wakes on the earlier Hey World", () => {
    expect(matchWake("Hey World, remember this fridge")).toEqual({ woke: true, rest: "remember this fridge" });
    expect(matchWake("hey world state how many are left")).toEqual({ woke: true, rest: "how many are left" });
  });

  it("does not wake on other speech", () => {
    expect(matchWake("the hawk saw the whole world")).toEqual({ woke: false, rest: "" });
    expect(matchWake("hey there how are you")).toEqual({ woke: false, rest: "" });
    expect(matchWake("hawkeye the movie")).toEqual({ woke: false, rest: "" });
  });
});
