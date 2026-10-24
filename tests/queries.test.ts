import { afterAll, beforeAll, expect, test } from "vitest";
import { connect } from "../src/db";
import { seed } from "../src/seed";
import { whoToMeet, recommendTalks, planTalk, recordMeeting, recall } from "../src/queries";

let ctx: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  ctx = await connect("hawkeye_test");
  await seed(ctx.graph);
});
afterAll(async () => {
  await ctx.graph.delete();
  await ctx.db.close();
});

test("whoToMeet ranks by shared topics and explains why", async () => {
  const res = await whoToMeet(ctx.graph, "me");
  expect(res[0].sharedTopics.length).toBeGreaterThanOrEqual(2);
  expect(res[0].why).toContain("both care about");
});

test("meeting someone removes them from suggestions and is recalled", async () => {
  await recordMeeting(ctx.graph, "me", "ana", "talked agent memory");
  expect((await whoToMeet(ctx.graph, "me")).some((p) => p.id === "ana")).toBe(false);
  expect((await recall(ctx.graph, "me"))[0].note).toBe("talked agent memory");
});

test("planning a talk hides clashing talks in the same slot", async () => {
  await planTalk(ctx.graph, "me", "t2", "planner-agent"); // slot s1
  const picks = await recommendTalks(ctx.graph, "me");
  expect(picks.some((t) => t.slot === "10:00")).toBe(false);
});
