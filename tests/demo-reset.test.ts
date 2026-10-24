import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_reset_test";

const { cypher } = await import("../lib/graph");
const { createPlace, findPlaceByName } = await import("../lib/world-store");
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
  });
});
