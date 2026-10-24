import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a throwaway graph on the local FalkorDB (npm run db:up).
process.env.FALKORDB_GRAPH = "hawkeye_house_test";

describe("house graph", () => {
  let mod: typeof import("../lib/house-graph");
  let store: typeof import("../lib/world-store");
  let graph: typeof import("../lib/graph");

  beforeAll(async () => {
    mod = await import("../lib/house-graph");
    store = await import("../lib/world-store");
    graph = await import("../lib/graph");
    await graph.cypher(`MATCH (n) DETACH DELETE n`);
    await mod.seedHouseStructure();
    const now = new Date();
    await store.createPlace({
      key: "container:fridge",
      kind: "container",
      name: "fridge",
      catalogued: true,
      description: `${mod.HOUSE_MARK}fridge`,
      items: [{ name: "egg", count: 4, since: now, by: "01" }],
      lastSeen: now,
      lastObserver: "01",
    });
    await mod.attachSite("kitchen", "container:fridge");
  });

  afterAll(async () => {
    await graph.cypher(`MATCH (n) DETACH DELETE n`);
  });

  it("has two roommates, linked to each other and to their phones", async () => {
    const { nodes, links } = await mod.readHouseGraph();
    expect(nodes.filter((n) => n.group === "person").map((n) => n.label).sort()).toEqual(["Arnav", "Thilak"]);
    expect(links.some((l) => l.type === "ROOMMATE_OF" && l.source === "person:thilak" && l.target === "person:arnav")).toBe(true);
    expect(links.filter((l) => l.type === "CARRIES")).toHaveLength(2);
  });

  it("shares every duty between both roommates and covers each area", async () => {
    const { links } = await mod.readHouseGraph();
    for (const duty of mod.HOUSE.duties) {
      expect(links.filter((l) => l.type === "RESPONSIBLE_FOR" && l.target === `duty:${duty.id}`)).toHaveLength(2);
      expect(links.some((l) => l.type === "COVERS" && l.source === `duty:${duty.id}` && l.target === `area:${duty.area}`)).toBe(true);
    }
  });

  it("nests items under their site and area with counts", async () => {
    const { nodes, links } = await mod.readHouseGraph();
    expect(links.some((l) => l.type === "HAS_SITE" && l.source === "area:kitchen" && l.target === "site:container:fridge")).toBe(true);
    const holds = links.find((l) => l.type === "HOLDS" && l.source === "site:container:fridge" && l.target === "item:egg");
    expect(holds?.count).toBe(4);
    expect(nodes.find((n) => n.id === "item:egg")?.count).toBe(4);
  });

  it("hangs a camera-made place that no area claims off the house", async () => {
    const now = new Date();
    await store.createPlace({
      key: "container:snack table",
      kind: "container",
      name: "snack table",
      catalogued: true,
      description: "",
      items: [],
      lastSeen: now,
      lastObserver: "01",
    });
    await graph.cypher(`MATCH (p:Place {key: 'container:snack table'}) MERGE (i:Item {name: 'chips'}) MERGE (p)-[:HOLDS {count: 1}]->(i)`);
    const { links } = await mod.readHouseGraph();
    expect(links.some((l) => l.type === "HAS_SITE" && l.source === "house:home" && l.target === "site:container:snack table")).toBe(true);
  });
});
