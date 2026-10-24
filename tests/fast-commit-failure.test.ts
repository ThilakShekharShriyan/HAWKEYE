import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_fast_fail_test";

// The event write fails: the count must not stay changed without its event.
const failOn = { call: 1, seen: 0 };
vi.mock("../lib/events-repo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/events-repo")>();
  return {
    ...real,
    insertEvent: vi.fn(async (input: Parameters<typeof real.insertEvent>[0]) => {
      failOn.seen++;
      if (failOn.seen === failOn.call) throw new Error("event store down");
      return real.insertEvent(input);
    }),
  };
});

const { cypher } = await import("../lib/graph");
const { createPlace, findPlaceByName } = await import("../lib/world-store");
const { applyTrackerDelta, applyTrackerDeltas } = await import("../lib/fast-commit-repo");

describe("a failed event write", () => {
  beforeAll(async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    await createPlace({ key: "container:table", kind: "container", name: "table", catalogued: true, description: "", items: [{ name: "water bottle", count: 2, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
  });
  afterAll(async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
  });

  it("takes back events already written when a later event of the same reach fails", async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    await createPlace({ key: "container:table", kind: "container", name: "table", catalogued: true, description: "", items: [{ name: "water bottle", count: 2, since: new Date(), by: "01" }, { name: "chips", count: 1, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
    failOn.call = 2; // the first event is written, the second fails
    failOn.seen = 0;
    await expect(
      applyTrackerDeltas({
        observerId: "01",
        place: "table",
        deltas: [
          { label: "bottle", before: 2, after: 1, startedAt: Date.now() },
          { label: "chips", before: 1, after: 0, startedAt: Date.now() },
        ],
      }),
    ).rejects.toThrow("event store down");
    const events = await cypher<{ n: unknown }>(`MATCH (e:Event {type: 'transition'}) RETURN count(e) AS n`);
    expect(Number(events[0].n)).toBe(0);
    const held = await cypher<{ n: unknown }>(`MATCH (:Place {name:'table'})-[h:HOLDS]->(:Item {name:'water bottle'}) RETURN h.count AS n`);
    expect(held[0]?.n).toBe(2);
  });

  it("rolls the place back and rethrows, so no count exists without its event", async () => {
    failOn.call = 1;
    failOn.seen = 0;
    await cypher(`MATCH (n) DETACH DELETE n`);
    await createPlace({ key: "container:table", kind: "container", name: "table", catalogued: true, description: "", items: [{ name: "water bottle", count: 2, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
    await expect(applyTrackerDelta({ observerId: "01", place: "table", delta: { label: "bottle", before: 2, after: 1, startedAt: Date.now() } })).rejects.toThrow("event store down");
    const place = await findPlaceByName("table");
    expect(place?.items.find((i) => i.name === "water bottle")?.count).toBe(2);
    expect(place?.lastChange).toBeUndefined();
    const held = await cypher<{ n: unknown }>(`MATCH (:Place {name:'table'})-[h:HOLDS]->(:Item {name:'water bottle'}) RETURN h.count AS n`);
    expect(held[0]?.n).toBe(2);
  });
});
