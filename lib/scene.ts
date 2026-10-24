import { canonicalName, itemKey, normName } from "@/lib/inventory";
import { cypher, newId } from "@/lib/graph";
import type { ObserverId } from "@/lib/types";

// One physical object is a Thing. The Kind is shared by every object of that
// name. A Slot is the coarse place the picture draws: left/center/right on a
// surface, shelves in a fridge. HOLDS stays a count of the Things still in a slot.

export type PlaceShape = "surface" | "shelves";

export type LayoutMark = { kind: string; slot: string; present: boolean };

export type SceneThing = {
  id: string;
  label: string;
  kind: string;
  context: string;
  restock: string | null;
  slot: string;
  state: "live" | "ghost";
  lastSeenBy: string | null;
  takenBy: string | null;
  takenAt: number | null;
  path: string;
};

export type PlaceScene = {
  shape: PlaceShape;
  slots: { name: string; things: SceneThing[] }[];
  ghosts: SceneThing[];
  highlight: { thingIds: string[]; path: string; question: string } | null;
};

const SURFACE = ["left", "center", "right"] as const;
const SHELVES = ["top", "middle", "bottom", "door"] as const;

export function placeShape(container: string): PlaceShape {
  return /fridge|refrigerator|freezer|cooler|cupboard|cabinet|pantry|wardrobe/.test(normName(container))
    ? "shelves"
    : "surface";
}

export function slotsFor(shape: PlaceShape): string[] {
  return shape === "shelves" ? [...SHELVES] : [...SURFACE];
}

export function normalizeSlot(slot: string, shape: PlaceShape) {
  const clean = normName(slot);
  const allowed = slotsFor(shape);
  if (allowed.includes(clean)) return clean;
  if (/left/.test(clean)) return shape === "surface" ? "left" : "door";
  if (/right/.test(clean)) return shape === "surface" ? "right" : "door";
  if (/top|upper/.test(clean)) return shape === "shelves" ? "top" : "center";
  if (/bottom|lower/.test(clean)) return shape === "shelves" ? "bottom" : "center";
  if (/door/.test(clean)) return shape === "shelves" ? "door" : "right";
  return shape === "shelves" ? "middle" : "center";
}

/** Shared facts that belong to the kind, not to one bottle. */
export function kindContext(name: string) {
  const key = itemKey(name);
  if (/pepsi|coke|soda|cola|juice|water|milk|beer|drink/.test(key)) {
    return { context: "a drink", restock: "hall cooler" };
  }
  if (/snack|chip|candy|chocolate|bar|cookie/.test(key)) {
    return { context: "a snack", restock: "hall counter" };
  }
  return { context: "a thing kept at a place", restock: null as string | null };
}

export function parseLayout(raw: unknown, shape: PlaceShape, known: string[] = []): LayoutMark[] {
  if (!Array.isArray(raw)) return [];
  const marks: LayoutMark[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { kind?: unknown; name?: unknown; slot?: unknown; present?: unknown };
    const named = typeof record.kind === "string" ? record.kind : typeof record.name === "string" ? record.name : "";
    const kind = canonicalName(named, known);
    if (!kind) continue;
    marks.push({
      kind,
      slot: normalizeSlot(typeof record.slot === "string" ? record.slot : "", shape),
      present: record.present !== false,
    });
  }
  return marks;
}

/** When the model gives counts and no layout, spread objects across the picture. */
export function layoutFromCounts(items: { name: string; count: number }[], shape: PlaceShape): LayoutMark[] {
  const slots = slotsFor(shape);
  const marks: LayoutMark[] = [];
  for (const item of items) {
    const count = Math.max(0, Math.floor(item.count));
    const chosen =
      count === 1
        ? [slots[Math.floor((slots.length - 1) / 2)]]
        : count === 2
          ? [slots[0], slots[slots.length - 1]]
          : Array.from({ length: count }, (_, index) => slots[Math.min(index, slots.length - 1)]);
    for (const slot of chosen) marks.push({ kind: item.name, slot, present: true });
  }
  return marks;
}

/** The objects still on the place, seated in the slots the layout named. */
export function endMarks(
  items: { name: string; count: number }[],
  layout: LayoutMark[],
  shape: PlaceShape,
): LayoutMark[] {
  const order = slotsFor(shape);
  const marks: LayoutMark[] = [];
  for (const item of items) {
    const fromLayout = layout
      .filter((mark) => mark.present && mark.kind === item.name)
      .map((mark) => mark.slot)
      .filter((slot, index, all) => all.indexOf(slot) === index)
      .sort((a, b) => order.indexOf(b) - order.indexOf(a));
    const slots: string[] = [];
    for (const slot of fromLayout) {
      if (slots.length >= item.count) break;
      slots.push(slot);
    }
    for (const slot of layoutFromCounts([item], shape).map((mark) => mark.slot)) {
      if (slots.length >= item.count) break;
      if (!slots.includes(slot)) slots.push(slot);
    }
    while (slots.length < item.count) slots.push(order[Math.min(slots.length, order.length - 1)]);
    for (const slot of slots) marks.push({ kind: item.name, slot, present: true });
  }
  return marks;
}

export function countsFromLayout(marks: LayoutMark[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const mark of marks) {
    if (!mark.present) continue;
    counts.set(mark.kind, (counts.get(mark.kind) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function pair(slot: string, kind: string) {
  return `${slot}|${kind}`;
}

function thingPath(
  thing: { label: string; kind: string; slot: string; state: "live" | "ghost"; lastSeenBy: string | null; takenBy: string | null; context: string; restock: string | null },
  placeName: string,
) {
  const shared = `${thing.kind} (${thing.context}${thing.restock ? `, restock from ${thing.restock}` : ""})`;
  if (thing.state === "ghost") {
    const who = thing.takenBy ? `Observer ${thing.takenBy}` : "Someone";
    return `${who} -TOOK-> ${thing.label} -KIND-> ${shared} -WAS_IN-> ${placeName}`;
  }
  const seen = thing.lastSeenBy ? ` -LAST_SEEN_BY-> Observer ${thing.lastSeenBy}` : "";
  return `${thing.label} -IN-> ${thing.slot} -ON-> ${placeName} -KIND-> ${shared}${seen}`;
}

type LiveRow = { id: string; slot: string; kind: string };

async function liveThings(placeKey: string) {
  return cypher<LiveRow & { lastSeen: unknown }>(
    `MATCH (p:Place {key: $key})-[:HAS_SLOT]->(s:Slot)<-[:IN]-(t:Thing)-[:KIND]->(k:Item)
     RETURN t.id AS id, s.name AS slot, k.name AS kind, t.lastSeen AS lastSeen
     ORDER BY t.lastSeen ASC`,
    { key: placeKey },
  );
}

async function ensureSlots(placeKey: string, shape: PlaceShape) {
  for (const slot of slotsFor(shape)) {
    await cypher(
      `MATCH (p:Place {key: $key})
       MERGE (s:Slot {id: $id})
       SET s.name = $name
       MERGE (p)-[:HAS_SLOT]->(s)
       MERGE (s)-[:ON]->(p)`,
      { key: placeKey, id: `${placeKey}:${slot}`, name: slot },
    );
  }
}

async function ensureKind(kind: string) {
  const facts = kindContext(kind);
  await cypher(
    `MERGE (k:Item {name: $kind})
     SET k:Kind, k.context = $context, k.restock = $restock`,
    { kind, context: facts.context, restock: facts.restock ?? "" },
  );
  if (facts.restock) {
    await cypher(
      `MATCH (k:Item {name: $kind})
       MERGE (r:Place {key: $restockKey})
       SET r.name = $restock, r.kind = 'restock'
       MERGE (k)-[:RESTOCK_FROM]->(r)`,
      { kind, restockKey: `restock:${facts.restock}`, restock: facts.restock },
    );
  }
}

async function createThing(placeKey: string, kind: string, slot: string, observerId: ObserverId, at: number) {
  const id = newId("thing");
  const label = `${kind} (${slot})`;
  await ensureKind(kind);
  await cypher(
    `MATCH (p:Place {key: $key})
     MERGE (s:Slot {id: $slotId})
     SET s.name = $slot
     MERGE (p)-[:HAS_SLOT]->(s)
     MERGE (s)-[:ON]->(p)
     CREATE (t:Thing {id: $id, label: $label, slot: $slot, lastSeen: $at, state: 'live'})
     MERGE (t)-[:IN]->(s)
     WITH t
     MATCH (k:Item {name: $kind})
     MERGE (t)-[:KIND]->(k)
     MERGE (o:Observer {id: $observerId})
     MERGE (t)-[:LAST_SEEN_BY]->(o)`,
    { key: placeKey, slotId: `${placeKey}:${slot}`, slot, id, label, at, kind, observerId },
  );
  return id;
}

async function touchThing(id: string, observerId: ObserverId, at: number) {
  await cypher(
    `MATCH (t:Thing {id: $id})-[old:LAST_SEEN_BY]->()
     DELETE old`,
    { id },
  );
  await cypher(
    `MATCH (t:Thing {id: $id})
     SET t.lastSeen = $at, t.state = 'live'
     WITH t
     MATCH (o:Observer {id: $observerId})
     MERGE (t)-[:LAST_SEEN_BY]->(o)`,
    { id, at, observerId },
  );
}

async function ghostThing(id: string, placeKey: string, observerId: ObserverId, at: number) {
  await cypher(
    `MATCH (t:Thing {id: $id})-[inn:IN]->(:Slot)
     DELETE inn`,
    { id },
  );
  await cypher(
    `MATCH (t:Thing {id: $id})
     SET t.state = 'ghost', t.takenAt = $at, t.takenBy = $observerId
     WITH t
     MATCH (p:Place {key: $key})
     MERGE (t)-[:WAS_IN]->(p)
     MERGE (o:Observer {id: $observerId})
     MERGE (o)-[:TOOK]->(t)`,
    { id, key: placeKey, at, observerId },
  );
}

async function moveThing(id: string, placeKey: string, slot: string, observerId: ObserverId, at: number, kind: string) {
  const label = `${kind} (${slot})`;
  await cypher(
    `MATCH (t:Thing {id: $id})-[inn:IN]->(:Slot)
     DELETE inn`,
    { id },
  );
  await cypher(
    `MATCH (t:Thing {id: $id})
     SET t.slot = $slot, t.label = $label, t.lastSeen = $at, t.state = 'live'
     WITH t
     MATCH (p:Place {key: $key})
     MERGE (s:Slot {id: $slotId})
     SET s.name = $slot
     MERGE (p)-[:HAS_SLOT]->(s)
     MERGE (s)-[:ON]->(p)
     MERGE (t)-[:IN]->(s)`,
    { id, slot, label, at, key: placeKey, slotId: `${placeKey}:${slot}` },
  );
  await touchThing(id, observerId, at);
}

async function projectHolds(placeKey: string, observerId: ObserverId, at: number) {
  await cypher(`MATCH (p:Place {key: $key}) OPTIONAL MATCH (p)-[h:HOLDS]->() DELETE h`, { key: placeKey });
  const rows = await cypher<{ kind: string; n: unknown }>(
    `MATCH (p:Place {key: $key})-[:HAS_SLOT]->(:Slot)<-[:IN]-(:Thing)-[:KIND]->(k:Item)
     RETURN k.name AS kind, count(k) AS n`,
    { key: placeKey },
  );
  for (const row of rows) {
    const count = typeof row.n === "number" ? row.n : Number(row.n);
    if (!row.kind || !Number.isFinite(count) || count <= 0) continue;
    await cypher(
      `MATCH (p:Place {key: $key})
       MERGE (k:Item {name: $kind})
       MERGE (p)-[r:HOLDS]->(k)
       SET r.count = $count, r.since = $at, r.by = $observerId`,
      { key: placeKey, kind: row.kind, count, at, observerId },
    );
  }
}

/**
 * Make the Things match this look. A full look drops anything no longer
 * present. A partial look only removes a thing the model marked present:false.
 */
export async function applyScene(input: {
  placeKey: string;
  placeName: string;
  shape: PlaceShape;
  marks: LayoutMark[];
  observerId: ObserverId;
  at: number;
  full: boolean;
}) {
  await cypher(`MATCH (p:Place {key: $key}) SET p.shape = $shape`, { key: input.placeKey, shape: input.shape });
  await ensureSlots(input.placeKey, input.shape);
  const live = await liveThings(input.placeKey);
  const groups = new Map<string, LiveRow[]>();
  for (const thing of live) {
    const key = pair(String(thing.slot), String(thing.kind));
    groups.set(key, [...(groups.get(key) ?? []), thing]);
  }

  const wanted = new Map<string, { slot: string; kind: string; count: number }>();
  for (const mark of input.marks) {
    if (!input.full && !mark.present) {
      const key = pair(mark.slot, mark.kind);
      const group = groups.get(key) ?? [];
      const victim = group.pop();
      if (victim) await ghostThing(String(victim.id), input.placeKey, input.observerId, input.at);
      continue;
    }
    if (!mark.present) continue;
    const key = pair(mark.slot, mark.kind);
    const current = wanted.get(key);
    wanted.set(key, { slot: mark.slot, kind: mark.kind, count: (current?.count ?? 0) + 1 });
  }

  if (input.full) {
    const order = slotsFor(input.shape);
    const byKind = new Map<string, LiveRow[]>();
    for (const thing of live) {
      const kind = String(thing.kind);
      byKind.set(kind, [...(byKind.get(kind) ?? []), thing]);
    }
    const needByKind = new Map<string, string[]>();
    for (const want of wanted.values()) {
      const list = needByKind.get(want.kind) ?? [];
      for (let count = 0; count < want.count; count += 1) list.push(want.slot);
      needByKind.set(want.kind, list);
    }
    const kinds = new Set([...byKind.keys(), ...needByKind.keys()]);
    for (const kind of kinds) {
      const have = [...(byKind.get(kind) ?? [])].sort(
        (a, b) => order.indexOf(String(a.slot)) - order.indexOf(String(b.slot)),
      );
      const need = needByKind.get(kind) ?? [];
      const drop = have.slice(0, Math.max(0, have.length - need.length));
      const keep = have.slice(drop.length);
      for (const thing of drop) await ghostThing(String(thing.id), input.placeKey, input.observerId, input.at);
      for (let index = 0; index < need.length; index += 1) {
        const slot = need[index];
        const thing = keep[index];
        if (!thing) await createThing(input.placeKey, kind, slot, input.observerId, input.at);
        else if (String(thing.slot) !== slot) {
          await moveThing(String(thing.id), input.placeKey, slot, input.observerId, input.at, kind);
        } else await touchThing(String(thing.id), input.observerId, input.at);
      }
    }
  } else {
    for (const [key, want] of wanted) {
      const group = groups.get(key) ?? [];
      for (const thing of group.slice(0, want.count)) await touchThing(String(thing.id), input.observerId, input.at);
      for (let index = group.length; index < want.count; index += 1) {
        await createThing(input.placeKey, want.kind, want.slot, input.observerId, input.at);
      }
    }
  }

  await projectHolds(input.placeKey, input.observerId, input.at);
}

function asText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asMillis(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function readScene(placeKey: string, placeName: string): Promise<PlaceScene> {
  const shapeRows = await cypher<{ shape: unknown }>(`MATCH (p:Place {key: $key}) RETURN p.shape AS shape`, {
    key: placeKey,
  });
  const stored = shapeRows[0]?.shape;
  const shape: PlaceShape = stored === "shelves" || stored === "surface" ? stored : placeShape(placeName);
  const live = await cypher<{
    slot: unknown;
    id: unknown;
    label: unknown;
    kind: unknown;
    context: unknown;
    restock: unknown;
    seenBy: unknown;
  }>(
    `MATCH (p:Place {key: $key})-[:HAS_SLOT]->(s:Slot)
     OPTIONAL MATCH (s)<-[:IN]-(t:Thing)-[:KIND]->(k:Item)
     OPTIONAL MATCH (t)-[:LAST_SEEN_BY]->(o:Observer)
     RETURN s.name AS slot, t.id AS id, t.label AS label, k.name AS kind, k.context AS context, k.restock AS restock, o.id AS seenBy`,
    { key: placeKey },
  );
  const ghosts = await cypher<{
    id: unknown;
    label: unknown;
    slot: unknown;
    kind: unknown;
    context: unknown;
    restock: unknown;
    takenBy: unknown;
    takenAt: unknown;
  }>(
    `MATCH (t:Thing)-[:WAS_IN]->(p:Place {key: $key})
     OPTIONAL MATCH (t)-[:KIND]->(k:Item)
     OPTIONAL MATCH (o:Observer)-[:TOOK]->(t)
     RETURN t.id AS id, t.label AS label, t.slot AS slot, k.name AS kind, k.context AS context, k.restock AS restock, o.id AS takenBy, t.takenAt AS takenAt`,
    { key: placeKey },
  );
  const highlightRows = await cypher<{ ids: unknown; path: unknown; question: unknown }>(
    `MATCH (p:Place {key: $key})
     RETURN p.highlightIds AS ids, p.highlightPath AS path, p.highlightQuestion AS question`,
    { key: placeKey },
  );
  const bySlot = new Map<string, SceneThing[]>();
  for (const slot of slotsFor(shape)) bySlot.set(slot, []);
  for (const row of live) {
    const slot = asText(row.slot) ?? "center";
    if (!asText(row.id) || !asText(row.kind)) continue;
    const thing: SceneThing = {
      id: String(row.id),
      label: asText(row.label) ?? `${row.kind} (${slot})`,
      kind: String(row.kind),
      context: asText(row.context) ?? kindContext(String(row.kind)).context,
      restock: asText(row.restock),
      slot,
      state: "live",
      lastSeenBy: asText(row.seenBy),
      takenBy: null,
      takenAt: null,
      path: "",
    };
    thing.path = thingPath(thing, placeName);
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), thing]);
  }
  const ghostThings = ghosts.flatMap((row) => {
    if (!asText(row.id)) return [];
    const thing: SceneThing = {
      id: String(row.id),
      label: asText(row.label) ?? `${row.kind ?? "thing"} (${row.slot ?? "slot"})`,
      kind: asText(row.kind) ?? "thing",
      context: asText(row.context) ?? kindContext(asText(row.kind) ?? "").context,
      restock: asText(row.restock),
      slot: asText(row.slot) ?? "center",
      state: "ghost",
      lastSeenBy: null,
      takenBy: asText(row.takenBy),
      takenAt: asMillis(row.takenAt),
      path: "",
    };
    thing.path = thingPath(thing, placeName);
    return [thing];
  });
  const highlight = highlightRows[0];
  const ids = Array.isArray(highlight?.ids) ? highlight.ids.map(String) : [];
  return {
    shape,
    slots: slotsFor(shape).map((name) => ({ name, things: bySlot.get(name) ?? [] })),
    ghosts: ghostThings,
    highlight: ids.length
      ? { thingIds: ids, path: asText(highlight?.path) ?? "", question: asText(highlight?.question) ?? "" }
      : null,
  };
}

export async function saveHighlight(placeKey: string, thingIds: string[], path: string, question: string) {
  await cypher(
    `MATCH (p:Place {key: $key})
     SET p.highlightIds = $ids, p.highlightPath = $path, p.highlightQuestion = $question, p.highlightAt = $at`,
    { key: placeKey, ids: thingIds, path, question, at: Date.now() },
  );
}

const SLOT_WORDS = ["left", "center", "right", "top", "middle", "bottom", "door"] as const;

/** "are left" is a count, not the left slot. "the left pepsi" is the slot. */
export function mentionedSlot(text: string) {
  const q = text.toLowerCase();
  if (/\b(on the left|the left|left (one|side|pepsi|bottle|can|item))\b/.test(q)) return "left";
  if (/\b(on the right|the right|right (one|side|pepsi|bottle|can|item))\b/.test(q)) return "right";
  for (const slot of SLOT_WORDS) {
    if (slot === "left" || slot === "right") continue;
    if (new RegExp(`\\b${slot}\\b`).test(q)) return slot;
  }
  return null;
}

export function highlightThings(scene: PlaceScene, text: string) {
  const q = text.toLowerCase();
  const slot = mentionedSlot(q);
  const aboutTaken = /\b(who took|taken|take|who removed|gone)\b/.test(q);
  const aboutHere = /\b(how many|still|remain|what is (?:still )?on|what's on|what is in|what's in)\b/.test(q) || /\bare left\b/.test(q);
  let pool = [...scene.slots.flatMap((entry) => entry.things), ...scene.ghosts];
  if (slot) pool = pool.filter((thing) => thing.slot === slot);
  const kindHits = pool.filter((thing) =>
    thing.kind.split(" ").some((word) => word.length > 2 && q.includes(word)),
  );
  if (kindHits.length > 0) pool = kindHits;
  if (aboutTaken && !aboutHere) pool = pool.filter((thing) => thing.state === "ghost");
  else if (aboutHere && !aboutTaken) pool = pool.filter((thing) => thing.state === "live");
  return {
    thingIds: pool.map((thing) => thing.id),
    path: pool.map((thing) => thing.path).join(" ; "),
  };
}
