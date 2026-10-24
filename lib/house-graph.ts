import { cypher } from "@/lib/graph";

// The house as a graph: who lives here, which areas and sites they share, what
// each site holds, and who is responsible for what. Sites are the same Place
// nodes the cameras update, so a sighting of the fridge changes the fridge you
// see here.
//
//   (Person)-[:LIVES_IN]->(House)-[:HAS_AREA]->(Area)-[:HAS_SITE]->(Place)-[:HOLDS]->(Item)
//   (Person)-[:ROOMMATE_OF]->(Person)
//   (Person)-[:RESPONSIBLE_FOR]->(Duty)-[:COVERS]->(Area)
//   (Person)-[:CARRIES]->(Observer)

export type HouseGroup = "house" | "person" | "area" | "site" | "item" | "duty" | "observer";

export type HouseNode = {
  id: string;
  label: string;
  group: HouseGroup;
  /** Quantity for items (summed over the sites holding them). */
  count?: number;
};

export type HouseLink = { source: string; target: string; type: string; count?: number };

export type HouseGraph = { nodes: HouseNode[]; links: HouseLink[] };

/** Marks places created by the house seed, so reseeding never replaces a real checkpoint. */
export const HOUSE_MARK = "[house seed] ";

type SiteSpec = { name: string; items: { name: string; count: number }[] };

export const HOUSE = {
  id: "home",
  name: "Home",
  // The demo is two roommates; each phone is an observer.
  people: [
    { id: "thilak", name: "Thilak", observer: "01" as const },
    { id: "arnav", name: "Arnav", observer: "02" as const },
  ],
  areas: [
    {
      id: "kitchen",
      name: "Kitchen",
      sites: [
        { name: "fridge", items: [{ name: "egg", count: 4 }, { name: "milk", count: 1 }, { name: "coke can", count: 2 }] },
        { name: "dishwasher", items: [] },
        { name: "microwave", items: [] },
        { name: "oven", items: [] },
      ] as SiteSpec[],
    },
    {
      id: "laundry",
      name: "Laundry",
      sites: [
        {
          name: "laundry shelf",
          items: [
            { name: "dishpods", count: 12 },
            { name: "lint roller", count: 1 },
            { name: "stain removers & boosters", count: 2 },
          ],
        },
      ] as SiteSpec[],
    },
    {
      id: "household",
      name: "Household",
      sites: [
        { name: "household shelf", items: [{ name: "bleach spray", count: 1 }, { name: "bounty", count: 3 }] },
      ] as SiteSpec[],
    },
  ],
  // Shared by both roommates: each duty covers one area.
  duties: [
    { id: "kitchen-upkeep", name: "Kitchen upkeep", area: "kitchen" },
    { id: "laundry-day", name: "Laundry", area: "laundry" },
    { id: "restock-supplies", name: "Restock household", area: "household" },
  ],
};

const EDGE_TYPES = ["LIVES_IN", "ROOMMATE_OF", "HAS_AREA", "HAS_SITE", "HOLDS", "RESPONSIBLE_FOR", "COVERS", "CARRIES"];

/** Creates or refreshes the house structure around the places. Sites are written by the caller. */
export async function seedHouseStructure() {
  await cypher(`MERGE (h:House {id: $id}) SET h.name = $name`, { id: HOUSE.id, name: HOUSE.name });
  for (const person of HOUSE.people) {
    await cypher(
      `MATCH (h:House {id: $house})
       MERGE (p:Person {id: $id}) SET p.name = $name
       MERGE (p)-[:LIVES_IN]->(h)
       MERGE (o:Observer {id: $observer})
       MERGE (p)-[:CARRIES]->(o)`,
      { house: HOUSE.id, id: person.id, name: person.name, observer: person.observer },
    );
  }
  const [a, b] = HOUSE.people;
  await cypher(
    `MATCH (a:Person {id: $a}), (b:Person {id: $b}) MERGE (a)-[:ROOMMATE_OF]->(b)`,
    { a: a.id, b: b.id },
  );
  for (const area of HOUSE.areas) {
    await cypher(
      `MATCH (h:House {id: $house})
       MERGE (a:Area {id: $id}) SET a.name = $name
       MERGE (h)-[:HAS_AREA]->(a)`,
      { house: HOUSE.id, id: area.id, name: area.name },
    );
  }
  for (const duty of HOUSE.duties) {
    await cypher(
      `MATCH (a:Area {id: $area})
       MERGE (d:Duty {id: $id}) SET d.name = $name
       MERGE (d)-[:COVERS]->(a)`,
      { area: duty.area, id: duty.id, name: duty.name },
    );
    for (const person of HOUSE.people) {
      await cypher(
        `MATCH (p:Person {id: $person}), (d:Duty {id: $duty}) MERGE (p)-[:RESPONSIBLE_FOR]->(d)`,
        { person: person.id, duty: duty.id },
      );
    }
  }
}

/** Puts an existing place under an area. */
export async function attachSite(areaId: string, placeKey: string) {
  await cypher(
    `MATCH (a:Area {id: $area}), (p:Place {key: $key}) MERGE (a)-[:HAS_SITE]->(p)`,
    { area: areaId, key: placeKey },
  );
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");

function idOf(label: string, row: Row, prefix: "a" | "b") {
  const id = str(row[`${prefix}id`]);
  const key = str(row[`${prefix}key`]);
  const name = str(row[`${prefix}name`]);
  switch (label) {
    case "Place":
      return key ? { id: `site:${key}`, label: name || key } : null;
    case "Item":
      return name ? { id: `item:${name}`, label: name } : null;
    default:
      return id ? { id: `${label.toLowerCase()}:${id}`, label: name || id } : null;
  }
}

const GROUP: Record<string, HouseGroup> = {
  House: "house",
  Person: "person",
  Area: "area",
  Place: "site",
  Item: "item",
  Duty: "duty",
  Observer: "observer",
};

/** The house as nodes and links for the 3D view. */
export async function readHouseGraph(): Promise<HouseGraph> {
  const rows = await cypher<Row>(
    `MATCH (a)-[r]->(b)
     WHERE type(r) IN $types
     RETURN labels(a)[0] AS al, a.id AS aid, a.key AS akey, a.name AS aname,
            type(r) AS rel, r.count AS count,
            labels(b)[0] AS bl, b.id AS bid, b.key AS bkey, b.name AS bname`,
    { types: EDGE_TYPES },
  );
  const nodes = new Map<string, HouseNode>();
  const links: HouseLink[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const al = str(row.al);
    const bl = str(row.bl);
    const a = idOf(al, row, "a");
    const b = idOf(bl, row, "b");
    if (!a || !b || !GROUP[al] || !GROUP[bl]) continue;
    for (const [node, label] of [[a, al], [b, bl]] as const) {
      if (!nodes.has(node.id)) nodes.set(node.id, { id: node.id, label: node.label, group: GROUP[label] });
    }
    const type = str(row.rel);
    const count = typeof row.count === "number" ? row.count : undefined;
    const key = `${a.id}|${type}|${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: a.id, target: b.id, type, ...(count !== undefined ? { count } : {}) });
    if (type === "HOLDS" && count !== undefined) {
      const item = nodes.get(b.id)!;
      item.count = (item.count ?? 0) + count;
    }
  }
  // Camera-made places that no area claims yet hang off the house.
  const houseId = `house:${HOUSE.id}`;
  if (nodes.has(houseId)) {
    const claimed = new Set(links.filter((link) => link.type === "HAS_SITE").map((link) => link.target));
    for (const node of nodes.values()) {
      if (node.group === "site" && !claimed.has(node.id)) {
        links.push({ source: houseId, target: node.id, type: "HAS_SITE" });
      }
    }
  }
  return { nodes: [...nodes.values()], links };
}
