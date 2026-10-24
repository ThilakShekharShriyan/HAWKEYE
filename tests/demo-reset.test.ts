import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_reset_test";

const { cypher } = await import("../lib/graph");
const { createPlace, findPlaceByName, patchPlace, startPrivacy } = await import("../lib/world-store");
const { insertEvent } = await import("../lib/events-repo");
const { HOUSE_EVENTS, seedHouseStructure } = await import("../lib/house-graph");
const { applyReset, planReset } = await import("../lib/demo-reset");

const count = async (query: string) => Number((await cypher<{ n: unknown }>(query))[0].n);

beforeAll(async () => {
  await cypher(`MATCH (n) DETACH DELETE n`);
  await seedHouseStructure();
  const now = new Date();
  await createPlace({ key: "container:fridge", kind: "container", name: "fridge", catalogued: true, description: "", seed: "house", items: [{ name: "egg", count: 4, since: now, by: "01" }], lastSeen: now, lastObserver: "01" });
  await createPlace({ key: "container:table", kind: "container", name: "table", catalogued: true, description: "", items: [{ name: "water bottle", count: 2, since: now, by: "01" }], lastSeen: now, lastObserver: "02" });
  await insertEvent({ type: "transition", title: "Taken", observerId: "02", location: ["kitchen", "fridge"], metadata: { object: "coke can", from: "fridge" }, summary: HOUSE_EVENTS[0].summary });
  await insertEvent({ type: "transition", title: "Taken", observerId: "02", location: ["table"], metadata: { object: "water bottle", from: "table" }, summary: "Arnav's camera saw a water bottle taken from the table." });
  await insertEvent({ type: "answer", title: "Answer", observerId: "01", summary: "Q: what happened? A: one bottle left." });
  await cypher(`CREATE (:Turn {id: 't1', content: 'what happened at the table'}), (:Fact {text: 'the table is by the window'})`);
  // A rehearsal camera saw the seeded fridge: a scene object, a ghost, a photo, and a privacy window that is still running.
  await cypher(`MATCH (p:Place {key: 'container:fridge'})
                CREATE (p)-[:HAS_SLOT]->(s:Slot {id: 'fridge:top'}), (:Thing {id: 'th1', label: 'milk'})-[:IN]->(s), (:Thing {id: 'th2', label: 'cola'})-[:WAS_IN]->(p)`);
  await patchPlace("container:fridge", { references: [{ image: "aGVsbG8=", at: now, observerId: "01" }] }, { watch: false });
  await startPrivacy("02", new Date(Date.now() - 60_000), new Date(Date.now() + 4 * 60_000));
});

afterAll(async () => {
  await cypher(`MATCH (n) DETACH DELETE n`);
});

describe("demo reset", () => {
  it("plans to remove only what cameras and conversation added", async () => {
    const plan = await planReset();
    expect(plan.places).toEqual(["table"]);
    expect(plan.events).toBe(2);
    expect(plan.memory.Turn).toBe(1);
    expect(plan.memory.Fact).toBe(1);
    expect(plan.seededWithPhotos).toEqual(["fridge"]);
    expect(plan.activePrivacy).toBe(1);
  });

  it("keeps the house, seeded sites and their sample history; removes the rest", async () => {
    await applyReset(await planReset());
    expect(await findPlaceByName("table")).toBeNull();
    expect(await findPlaceByName("fridge")).not.toBeNull();
    expect(await count(`MATCH (:Place {name: 'fridge'})-[:HOLDS]->(:Item {name: 'egg'}) RETURN count(*) AS n`)).toBe(1);
    expect(await count(`MATCH (e:Event) RETURN count(e) AS n`)).toBe(1);
    expect(await count(`MATCH (e:Event {summary: $s}) RETURN count(e) AS n`.replace("$s", JSON.stringify(HOUSE_EVENTS[0].summary)))).toBe(1);
    expect(await count(`MATCH (n) WHERE n:Turn OR n:Fact RETURN count(n) AS n`)).toBe(0);
    expect(await count(`MATCH (:Observer)-[w:WATCHES]->() RETURN count(w) AS n`)).toBe(0);
    expect(await count(`MATCH (p:Person) RETURN count(p) AS n`)).toBe(2);
    expect(await count(`MATCH (n) WHERE n:Thing OR n:Slot RETURN count(n) AS n`)).toBe(0);
    expect((await findPlaceByName("fridge"))?.references ?? []).toEqual([]);
    expect(await count(`MATCH (w:Privacy) RETURN count(w) AS n`)).toBe(0);
  });

  it("sees every camera-made place, not only the most recent ones", async () => {
    for (let i = 0; i < 3; i++) {
      await createPlace({ key: `container:old ${i}`, kind: "container", name: `old ${i}`, catalogued: true, description: "", items: [], lastSeen: new Date(1000 + i), lastObserver: "01" });
    }
    const plan = await planReset();
    expect(plan.places.sort()).toEqual(["old 0", "old 1", "old 2"]);
  });
});

describe("phone links come only from cameras", () => {
  it("a seed write links no phone, and does not remove a link a real sighting made", async () => {
    await cypher(`MATCH (n) DETACH DELETE n`);
    const now = new Date();
    await createPlace({ key: "container:oven", kind: "container", name: "oven", catalogued: true, description: "", seed: "house", items: [], lastSeen: now, lastObserver: "01" }, { watch: false });
    expect(await count(`MATCH (:Observer)-[w:WATCHES]->(:Place {name: 'oven'}) RETURN count(w) AS n`)).toBe(0);
    // A camera (Arnav's phone) sees the oven: a real link.
    await patchPlace("container:oven", { lastObserver: "02" });
    expect(await count(`MATCH (:Observer {id: '02'})-[w:WATCHES]->(:Place {name: 'oven'}) RETURN count(w) AS n`)).toBe(1);
    // Reseeding the oven keeps it.
    await patchPlace("container:oven", { items: [], description: "reset" }, { watch: false });
    expect(await count(`MATCH (:Observer {id: '02'})-[w:WATCHES]->(:Place {name: 'oven'}) RETURN count(w) AS n`)).toBe(1);
  });
});

