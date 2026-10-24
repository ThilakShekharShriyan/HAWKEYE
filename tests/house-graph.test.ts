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

  it("hangs camera-made places that no area claims off the house, empty or not", async () => {
    const now = new Date();
    // One with nothing in it yet (a partial sighting), one holding something: neither claimed by an area.
    await store.createPlace({ key: "container:empty shelf", kind: "container", name: "empty shelf", catalogued: false, description: "", items: [], lastSeen: now, lastObserver: "01" });
    await store.createPlace({ key: "container:snack table", kind: "container", name: "snack table", catalogued: true, description: "", items: [{ name: "chips", count: 1, since: now, by: "01" }], lastSeen: now, lastObserver: "01" });
    const { nodes, links } = await mod.readHouseGraph();
    for (const key of ["container:empty shelf", "container:snack table"]) {
      expect(nodes.some((n) => n.id === `site:${key}` && n.group === "site")).toBe(true);
      expect(links.some((l) => l.type === "HAS_SITE" && l.source === "house:home" && l.target === `site:${key}`)).toBe(true);
    }
    expect(links.some((l) => l.type === "HOLDS" && l.source === "site:container:snack table" && l.target === "item:chips")).toBe(true);
  });

  it("only reads what belongs to the house: another house's people and areas stay out", async () => {
    await graph.cypher(`CREATE (h:House {id: 'other', name: 'Other'}), (p:Person {id: 'stranger', name: 'Stranger'}), (a:Area {id: 'attic', name: 'Attic'})
                        CREATE (p)-[:LIVES_IN]->(h), (h)-[:HAS_AREA]->(a)`);
    const { nodes } = await mod.readHouseGraph();
    expect(nodes.some((n) => n.id === "person:stranger" || n.id === "area:attic" || n.id === "house:other")).toBe(false);
  });

  it("draws each camera site with its own items when there are more places than the cap", async () => {
    // 105 unclaimed places, each holding one item; the view takes the 100 most recently seen, all with their links.
    await graph.cypher(`UNWIND range(1, 105) AS i
      CREATE (p:Place {key: 'container:cap-' + toString(i), kind: 'container', name: 'cap ' + toString(i), lastSeen: 1000 + i})
      MERGE (it:Item {name: 'thing ' + toString(i)})
      CREATE (p)-[:HOLDS {count: 1}]->(it)`);
    const { nodes, links } = await mod.readHouseGraph();
    // Other tests' unclaimed places (empty shelf, snack table) are in the graph too and count against the cap.
    const unclaimed = links.filter((l) => l.type === "HAS_SITE" && l.source === "house:home").map((l) => l.target);
    expect(unclaimed).toHaveLength(100);
    for (const site of nodes.filter((n) => n.id.startsWith("site:container:cap-"))) {
      expect(unclaimed).toContain(site.id);
      expect(links.some((l) => l.type === "HOLDS" && l.source === site.id)).toBe(true);
    }
    // The oldest are the ones left out, with their items.
    expect(nodes.some((n) => n.id === "site:container:cap-1")).toBe(false);
    expect(nodes.some((n) => n.id === "item:thing 1")).toBe(false);
    expect(nodes.some((n) => n.id === "site:container:cap-105")).toBe(true);
  });
});
