import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_fast_fail_test";

// The event write fails: the count must not stay changed without its event.
vi.mock("../lib/events-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/events-repo")>()),
  insertEvent: vi.fn(async () => {
    throw new Error("event store down");
  }),
}));

const { cypher } = await import("../lib/graph");
const { createPlace, findPlaceByName } = await import("../lib/world-store");
const { applyTrackerDelta } = await import("../lib/fast-commit-repo");

describe("a failed event write", () => {
  beforeAll(async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    await createPlace({ key: "container:table", kind: "container", name: "table", catalogued: true, description: "", items: [{ name: "water bottle", count: 2, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
  });
  afterAll(async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
  });

  it("rolls the place back and rethrows, so no count exists without its event", async () => {
    await expect(applyTrackerDelta({ observerId: "01", place: "table", delta: { label: "bottle", before: 2, after: 1, startedAt: Date.now() } })).rejects.toThrow("event store down");
    const place = await findPlaceByName("table");
    expect(place?.items.find((i) => i.name === "water bottle")?.count).toBe(2);
    expect(place?.lastChange).toBeUndefined();
    const held = await cypher<{ n: unknown }>(`MATCH (:Place {name:'table'})-[h:HOLDS]->(:Item {name:'water bottle'}) RETURN h.count AS n`);
    expect(held[0]?.n).toBe(2);
  });
});
