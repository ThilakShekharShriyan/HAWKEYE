import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_fast_test";

const { cypher } = await import("../lib/graph");
const { createPlace, findPlaceByName, patchPlace } = await import("../lib/world-store");
const { applyTrackerDelta, applyTrackerDeltas, itemForLabel } = await import("../lib/fast-commit-repo");

const holds = async (place: string, item: string) =>
  (await cypher<{ n: unknown }>(`MATCH (:Place {name: $place})-[h:HOLDS]->(:Item {name: $item}) RETURN h.count AS n`, { place, item }))[0]?.n;
const events = async () =>
  cypher<{ title: unknown; summary: unknown }>(`MATCH (e:Event {type: 'transition'}) RETURN e.title AS title, e.summary AS summary ORDER BY e.ts`);

const delta = (over: Partial<{ label: string; before: number; after: number; startedAt: number }> = {}) => ({
  label: "bottle",
  before: 2,
  after: 1,
  startedAt: Date.now(),
  ...over,
});

beforeEach(async () => {
  await cypher(`MATCH (n) DETACH DELETE n`);
  const now = new Date(Date.now() - 60_000);
  await createPlace({
    key: "container:table",
    kind: "container",
    name: "table",
    place: "kitchen",
    catalogued: true,
    description: "",
    items: [
      { name: "water bottle", count: 2, since: now, by: "01" },
      { name: "chips", count: 1, since: now, by: "01" },
    ],
    lastSeen: now,
    lastObserver: "01",
  });
});

afterAll(async () => {
  await cypher(`MATCH (n) DETACH DELETE n`);
});

describe("applyTrackerDelta", () => {
  it("lowers the count on the HOLDS link in FalkorDB and records a Taken event", async () => {
    expect(await holds("table", "water bottle")).toBe(2);
    const result = await applyTrackerDelta({ observerId: "02", place: "table", delta: delta() });
    expect(result).toEqual({ applied: true, item: "water bottle", from: 2, to: 1 });
    expect(await holds("table", "water bottle")).toBe(1);
    expect(await holds("table", "chips")).toBe(1);
    const saved = await findPlaceByName("table");
    expect(saved?.items.find((i) => i.name === "water bottle")?.count).toBe(1);
    expect(saved?.lastChange?.summary).toBe("-1 water bottle (2→1)");
    const log = await events();
    expect(log).toHaveLength(1);
    expect(log[0].title).toBe("Taken");
    expect(String(log[0].summary)).toContain("1 water bottle was taken from the table");
  });

  it("raises the count and records Added when the tracker sees one put back", async () => {
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 1, after: 2 }) });
    expect(result).toMatchObject({ applied: true, from: 2, to: 3 });
    expect(await holds("table", "water bottle")).toBe(3);
    expect((await events())[0].title).toBe("Added");
  });

  it("matches a table that has been renamed to table 2 by its prefix", async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    await createPlace({ key: "container:table 2", kind: "container", name: "table 2", catalogued: true, description: "", items: [{ name: "cup", count: 3, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ label: "cup", before: 3, after: 2 }) });
    expect(result).toMatchObject({ applied: true, to: 2 });
  });

  it("skips an item an episode already changed since the hand came in", async () => {
    const hand = Date.now() - 20_000;
    await patchPlace("container:table", { lastChange: { summary: "-1 water bottle (2→1)", by: "01", at: new Date(), items: ["water bottle"], source: "episode" } });
    const skipped = await applyTrackerDelta({ observerId: "02", place: "table", delta: delta({ startedAt: hand }) });
    expect(skipped).toEqual({ applied: false, reason: "already recorded by an episode" });
    expect(await holds("table", "water bottle")).toBe(2);
    expect(await events()).toHaveLength(0);
  });

  it("does not let an episode's change to another item suppress this one", async () => {
    const hand = Date.now() - 20_000;
    await patchPlace("container:table", { lastChange: { summary: "-1 chips (2→1)", by: "01", at: new Date(), items: ["chips"], source: "episode" } });
    const result = await applyTrackerDelta({ observerId: "02", place: "table", delta: delta({ startedAt: hand }) });
    expect(result).toMatchObject({ applied: true, from: 2, to: 1 });
  });

  it("moves observedAt forward so an older episode cannot overwrite the new count", async () => {
    const before = Date.now();
    await applyTrackerDelta({ observerId: "01", place: "table", delta: delta() });
    const saved = await findPlaceByName("table");
    expect(saved!.observedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("refuses unknown places, unknown items, and a count that already matches", async () => {
    expect((await applyTrackerDelta({ observerId: "01", place: "garage", delta: delta() })).applied).toBe(false);
    expect((await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ label: "laptop" }) })).applied).toBe(false);
    expect((await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 2, after: 2 }) })).applied).toBe(false);
    expect(await holds("table", "water bottle")).toBe(2);
    expect(await events()).toHaveLength(0);
  });

  it("never takes a count below zero and drops an item that reaches zero", async () => {
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 5, after: 0 }) });
    expect(result).toMatchObject({ applied: true, to: 0 });
    expect(await holds("table", "water bottle")).toBeUndefined();
  });

  it("restores an item that was taken down to zero when one is put back", async () => {
    await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 2, after: 0 }) });
    expect(await holds("table", "water bottle")).toBeUndefined();
    const back = await applyTrackerDelta({ observerId: "02", place: "table", delta: delta({ before: 0, after: 1, startedAt: Date.now() + 1000 }) });
    expect(back).toEqual({ applied: true, item: "water bottle", from: 0, to: 1 });
    expect(await holds("table", "water bottle")).toBe(1);
  });

  it("leaves ambiguous items to the model: two bottles at one place change nothing", async () => {
    await patchPlace("container:table", {
      items: [
        { name: "water bottle", count: 2, since: new Date(), by: "01" },
        { name: "beer bottle", count: 5, since: new Date(), by: "01" },
      ],
    });
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta() });
    expect(result.applied).toBe(false);
    expect(await holds("table", "water bottle")).toBe(2);
    expect(await holds("table", "beer bottle")).toBe(5);
  });

  it("does not match on a shared non-head word", () => {
    const items = [{ name: "orange juice", count: 1 }, { name: "phone case", count: 1 }, { name: "wine glass", count: 2 }];
    expect(itemForLabel(items, "orange")).toBeNull();
    expect(itemForLabel(items, "cell phone")).toBeNull();
    expect(itemForLabel(items, "glass")?.name).toBe("wine glass");
  });

  it("refuses an ambiguous place hint: table with both table 2 and table 3", async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    for (const name of ["table 2", "table 3"]) {
      await createPlace({ key: `container:${name}`, kind: "container", name, catalogued: true, description: "", items: [{ name: "cup", count: 3, since: new Date(), by: "01" }], lastSeen: new Date(), lastObserver: "01" });
    }
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ label: "cup", before: 3, after: 2 }) });
    expect(result.applied).toBe(false);
    expect(await holds("table 2", "cup")).toBe(3);
    expect(await holds("table 3", "cup")).toBe(3);
  });

  it("applies every change from one reach together, one event each", async () => {
    const results = await applyTrackerDeltas({
      observerId: "01",
      place: "table",
      deltas: [delta(), { label: "chips", before: 1, after: 0, startedAt: Date.now() }],
    });
    // "chips" has head noun chips -> chip; stored "chips" -> chip: one match.
    expect(results.map((r) => r.applied)).toEqual([true, true]);
    expect(await holds("table", "water bottle")).toBe(1);
    expect(await holds("table", "chips")).toBeUndefined();
    expect(await events()).toHaveLength(2);
    expect((await findPlaceByName("table"))?.lastChange?.items?.sort()).toEqual(["chips", "water bottle"]);
  });

  it("writes nothing when the commit guard says the capture lease moved on", async () => {
    const results = await applyTrackerDeltas({ observerId: "01", place: "table", deltas: [delta()], guard: () => false });
    expect(results).toEqual([{ applied: false, reason: "not the capture leader" }]);
    expect(await holds("table", "water bottle")).toBe(2);
    expect(await events()).toHaveLength(0);
  });

  it("does not overwrite a still-stored bottle when a put-back is ambiguous", async () => {
    // Water bottles were taken before; beer bottles are also stored. "bottle" now means two items.
    await cypher(`CREATE (:Event {id: 'e-old', type: 'transition', title: 'Taken', metaFrom: 'table', metaObject: 'water bottle', ts: 1})`);
    await patchPlace("container:table", {
      items: [
        { name: "water bottle", count: 3, since: new Date(), by: "01" },
        { name: "beer bottle", count: 2, since: new Date(), by: "01" },
      ],
    });
    const result = await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 0, after: 1 }) });
    expect(result.applied).toBe(false);
    expect(await holds("table", "water bottle")).toBe(3);
    expect(await holds("table", "beer bottle")).toBe(2);
    expect(await events()).toHaveLength(1); // only the seeded history event: nothing new was written
  });

  it("finds the last thing taken even when other Taken events have no object", async () => {
    await cypher(`CREATE (:Event {id: 'e-a', type: 'transition', title: 'Taken', metaFrom: 'table', metaObject: '', ts: 5}),
                         (:Event {id: 'e-b', type: 'transition', title: 'Taken', metaFrom: 'table', metaObject: 'water bottle', ts: 4})`);
    await applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ before: 2, after: 0 }) });
    const back = await applyTrackerDelta({ observerId: "02", place: "table", delta: delta({ before: 0, after: 1, startedAt: Date.now() + 1000 }) });
    expect(back).toEqual({ applied: true, item: "water bottle", from: 0, to: 1 });
  });

  it("serialises two simultaneous changes so each is counted exactly once", async () => {
    // Two phones each see one bottle leave at the same moment: 2 -> 1 -> 0, never 2 -> 1 twice.
    const results = await Promise.all([
      applyTrackerDelta({ observerId: "01", place: "table", delta: delta({ startedAt: Date.now() + 1000 }) }),
      applyTrackerDelta({ observerId: "02", place: "table", delta: delta({ startedAt: Date.now() + 2000 }) }),
    ]);
    expect(results.every((r) => r.applied)).toBe(true);
    expect(results.map((r) => (r.applied ? `${r.from}>${r.to}` : "")).sort()).toEqual(["1>0", "2>1"]);
    expect(await holds("table", "water bottle")).toBeUndefined(); // reached zero, so no link remains
    expect(await events()).toHaveLength(2);
  });
});

describe("itemForLabel", () => {
  it("matches a detector label to a stored item name", () => {
    const items = [{ name: "water bottle", count: 2 }, { name: "chips", count: 1 }];
    expect(itemForLabel(items, "bottle")?.name).toBe("water bottle");
    expect(itemForLabel(items, "laptop")).toBeNull();
  });
});
