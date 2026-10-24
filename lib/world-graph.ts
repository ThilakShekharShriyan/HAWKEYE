import { cypher } from "@/lib/graph";

export type GraphGroup = "observer" | "event" | "thing" | "slot" | "place" | "kind";

export type GraphNode = {
  id: string;
  label: string;
  group: GraphGroup;
  place: string | null;
  ghost: boolean;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
};

export type WorldGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value ? value : fallback;
}

/** The mesh as nodes and edges: who, which place, which object, which kind. */
export async function readWorldGraph(): Promise<WorldGraph> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (node: GraphNode) => nodes.set(node.id, node);
  const link = (from: string, type: string, to: string) => {
    if (!from || !to || from === to) return;
    edges.push({ id: `${from}|${type}|${to}`, from, to, type });
  };

  const observers = await cypher<{ id: unknown }>(`MATCH (o:Observer) RETURN o.id AS id`);
  for (const row of observers) {
    const id = text(row.id);
    if (id) add({ id: `observer:${id}`, label: `Observer ${id}`, group: "observer", place: null, ghost: false });
  }

  const places = await cypher<{ key: unknown; name: unknown; kind: unknown; mark: unknown }>(
    `MATCH (p:Place) RETURN p.key AS key, p.name AS name, p.kind AS kind, p.mark AS mark`,
  );
  for (const row of places) {
    const key = text(row.key);
    const name = text(row.name, "place");
    if (!key) continue;
    const restock = row.kind === "restock";
    add({
      id: `place:${key}`,
      label: restock ? name : text(row.mark) ? `${name} — ${text(row.mark)}` : name,
      group: "place",
      place: restock ? null : name,
      ghost: false,
    });
  }

  const things = await cypher<{ id: unknown; label: unknown; state: unknown; place: unknown }>(
    `MATCH (t:Thing)
     OPTIONAL MATCH (t)-[:IN]->(:Slot)<-[:HAS_SLOT]-(live:Place)
     OPTIONAL MATCH (t)-[:WAS_IN]->(gone:Place)
     RETURN t.id AS id, t.label AS label, t.state AS state, coalesce(live.name, gone.name) AS place`,
  );
  for (const row of things) {
    const id = text(row.id);
    if (!id) continue;
    add({
      id: `thing:${id}`,
      label: text(row.label, "thing"),
      group: "thing",
      place: text(row.place) || null,
      ghost: row.state === "ghost",
    });
  }

  const slots = await cypher<{ id: unknown; name: unknown; place: unknown }>(
    `MATCH (p:Place)-[:HAS_SLOT]->(s:Slot) RETURN s.id AS id, s.name AS name, p.name AS place`,
  );
  for (const row of slots) {
    const id = text(row.id);
    if (!id) continue;
    add({ id: `slot:${id}`, label: text(row.name, "slot"), group: "slot", place: text(row.place) || null, ghost: false });
  }

  const kinds = await cypher<{ name: unknown; context: unknown }>(
    `MATCH (k:Item) WHERE k:Kind OR k.context IS NOT NULL RETURN k.name AS name, k.context AS context`,
  );
  for (const row of kinds) {
    const name = text(row.name);
    if (!name) continue;
    add({
      id: `kind:${name}`,
      label: text(row.context) ? `${name} · ${text(row.context)}` : name,
      group: "kind",
      place: null,
      ghost: false,
    });
  }

  const events = await cypher<{ id: unknown; title: unknown; type: unknown; place: unknown }>(
    `MATCH (e:Event)-[:ABOUT]->(p:Place)
     WHERE e.type IN ['transition', 'observation']
     RETURN e.id AS id, e.title AS title, e.type AS type, p.name AS place
     ORDER BY e.ts DESC
     LIMIT 8`,
  );
  for (const row of events) {
    const id = text(row.id);
    if (!id) continue;
    add({
      id: `event:${id}`,
      label: text(row.title, text(row.type, "event")),
      group: "event",
      place: text(row.place) || null,
      ghost: false,
    });
  }

  const relations = await cypher<{ from: unknown; type: unknown; to: unknown }>(
    `MATCH (a)-[r]->(b)
     WHERE type(r) IN ['TOOK','WAS_IN','LAST_SEEN_BY','IN','KIND','HOLDS','HAS_SLOT','WATCHES','RESTOCK_FROM','SAW','ABOUT','OF']
     RETURN
       CASE
         WHEN a:Observer THEN 'observer:' + a.id
         WHEN a:Thing THEN 'thing:' + a.id
         WHEN a:Slot THEN 'slot:' + a.id
         WHEN a:Place THEN 'place:' + a.key
         WHEN a:Item THEN 'kind:' + a.name
         WHEN a:Event THEN 'event:' + a.id
         ELSE ''
       END AS from,
       type(r) AS type,
       CASE
         WHEN b:Observer THEN 'observer:' + b.id
         WHEN b:Thing THEN 'thing:' + b.id
         WHEN b:Slot THEN 'slot:' + b.id
         WHEN b:Place THEN 'place:' + b.key
         WHEN b:Item THEN 'kind:' + b.name
         WHEN b:Event THEN 'event:' + b.id
         ELSE ''
       END AS to
     LIMIT 200`,
  );
  for (const row of relations) link(text(row.from), text(row.type), text(row.to));

  const known = nodes;
  return {
    nodes: [...known.values()],
    edges: edges.filter((edge) => known.has(edge.from) && known.has(edge.to)),
  };
}
