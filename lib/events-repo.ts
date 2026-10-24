import { embedText } from "@/lib/embed";
import type { QueryParams } from "falkordb";
import {
  asDate,
  cypher,
  fulltextQuery,
  newId,
  onGraphEvent,
  parseDoc,
  publishGraphEvent,
  serialize,
  vecLiteral,
} from "@/lib/graph";
import type { EventMetadata, ObserverId, WorldEvent } from "@/lib/types";

export type EventDoc = Omit<WorldEvent, "id" | "timestamp"> & {
  id: string;
  ts: Date;
  summary: string;
};

const RECALLABLE = ["memory", "observation", "context", "transition", "location"];

export function formatClock(date: Date) {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

export function toWorldEvent(doc: EventDoc): WorldEvent {
  return {
    id: doc.id,
    timestamp: formatClock(doc.ts),
    observerId: doc.observerId,
    type: doc.type,
    title: doc.title,
    message: doc.message,
    location: doc.location,
    confidence: doc.confidence,
    intent: doc.intent,
    metadata: doc.metadata,
  };
}

function revive(raw: EventDoc): EventDoc {
  return { ...raw, ts: asDate(raw.ts) };
}

function read(value: unknown) {
  const doc = parseDoc<EventDoc>(value);
  return doc ? revive(doc) : null;
}

function namesOf(location: string[] | undefined, metadata?: EventMetadata) {
  const names = new Set<string>();
  for (const part of location ?? []) if (part) names.add(part);
  for (const part of [metadata?.from, metadata?.to, metadata?.object]) {
    if (typeof part === "string" && part && !/^(observer|seen by|unknown)/i.test(part)) names.add(part);
  }
  return [...names];
}

async function linkEvent(id: string, observerId: ObserverId | undefined, names: string[], object?: string) {
  if (observerId) {
    await cypher(
      `MATCH (e:Event {id: $id})
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:SAW]->(e)`,
      { id, observerId },
    );
  }
  if (names.length > 0) {
    await cypher(
      `MATCH (e:Event {id: $id})
       UNWIND $names AS name
       MATCH (p:Place {kind: 'container', name: name})
       MERGE (e)-[:ABOUT]->(p)`,
      { id, names },
    );
  }
  if (object) {
    await cypher(
      `MATCH (e:Event {id: $id})
       MERGE (i:Item {name: $object})
       MERGE (e)-[:OF]->(i)`,
      { id, object },
    );
  }
}

async function attachEmbedding(id: string, summary: string) {
  const embedding = await embedText(summary);
  if (!embedding) return;
  await cypher(`MATCH (e:Event {id: $id}) SET e.embedding = ${vecLiteral(embedding)}`, { id });
}

export async function insertEvent(input: {
  type: WorldEvent["type"];
  title: string;
  observerId?: ObserverId;
  message?: string;
  intent?: WorldEvent["intent"];
  location?: string[];
  metadata?: EventMetadata;
  summary?: string;
}) {
  const doc: EventDoc = {
    ...input,
    id: newId("evt"),
    ts: new Date(),
    summary: input.summary ?? input.message ?? input.title,
  };
  const names = namesOf(doc.location, doc.metadata);
  await cypher(
    `CREATE (e:Event {
       id: $id,
       type: $type,
       title: $title,
       summary: $summary,
       ts: $ts,
       observerId: $observerId,
       location: $location,
       metaFrom: $metaFrom,
       metaTo: $metaTo,
       metaObject: $metaObject,
       doc: $doc
     })`,
    {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      summary: doc.summary,
      ts: doc.ts.getTime(),
      observerId: doc.observerId ?? "",
      location: doc.location ?? [],
      metaFrom: doc.metadata?.from ?? "",
      metaTo: doc.metadata?.to ?? "",
      metaObject: doc.metadata?.object ?? "",
      doc: serialize(doc),
    },
  );
  await linkEvent(doc.id, doc.observerId, names, doc.metadata?.object).catch((cause) => {
    console.warn(`[graph] event links skipped: ${cause instanceof Error ? cause.message : cause}`);
  });
  publishGraphEvent(toWorldEvent(doc));
  void attachEmbedding(doc.id, doc.summary).catch((cause) => {
    console.warn(`[graph] embedding skipped: ${cause instanceof Error ? cause.message : cause}`);
  });
  return doc;
}

export function onEvent(listener: (event: WorldEvent) => void) {
  return onGraphEvent((event) => listener(event as WorldEvent));
}

async function docs(query: string, params?: QueryParams) {
  const rows = await cypher<{ doc: unknown }>(query, params);
  return rows.flatMap((row) => {
    const doc = read(row.doc);
    return doc ? [doc] : [];
  });
}

export async function recentEvents(limit = 40) {
  const found = await docs(
    `MATCH (e:Event) RETURN e.doc AS doc ORDER BY e.ts DESC LIMIT ${Math.floor(limit)}`,
  );
  return found.reverse().map(toWorldEvent);
}

export async function eventsByType(type: string, limit: number) {
  return docs(
    `MATCH (e:Event {type: $type}) RETURN e.doc AS doc ORDER BY e.ts DESC LIMIT ${Math.floor(limit)}`,
    { type },
  );
}

export async function eventsSince(type: string, since: Date, limit: number) {
  const found = await docs(
    `MATCH (e:Event {type: $type})
     WHERE e.ts >= $since
     RETURN e.doc AS doc
     ORDER BY e.ts ASC
     LIMIT ${Math.floor(limit)}`,
    { type, since: since.getTime() },
  );
  return found;
}

export async function eventsAbout(name: string, limit: number) {
  const found = await docs(
    `MATCH (e:Event)
     WHERE $name IN coalesce(e.location, [])
        OR e.metaFrom = $name
        OR e.metaTo = $name
        OR e.metaObject = $name
        OR e.title STARTS WITH $prefix
     RETURN e.doc AS doc
     ORDER BY e.ts DESC
     LIMIT ${Math.floor(limit)}`,
    { name, prefix: `${name} ` },
  );
  return found;
}

export type ScoredEvent = EventDoc & { score: number };

async function scored(query: string, params?: QueryParams) {
  const rows = await cypher<{ doc: unknown; score: unknown }>(query, params);
  return rows.flatMap((row) => {
    const doc = read(row.doc);
    return doc ? [{ ...doc, score: typeof row.score === "number" ? row.score : Number(row.score) || 0 }] : [];
  });
}

/** Meaning plus keywords, then the path through the graph that justifies each hit. */
export async function searchEvents(query: string, limit: number) {
  const k = Math.max(limit * 2, 4);
  const text = fulltextQuery(query);
  let mode: "hybrid" | "vector" | "fulltext" | "recent" = "recent";
  const hits: ScoredEvent[] = [];

  try {
    const embedding = await embedText(query);
    if (embedding) {
      mode = "vector";
      const vectorHits = await scored(
        `CALL db.idx.vector.queryNodes('Event', 'embedding', ${k}, ${vecLiteral(embedding)})
         YIELD node, score
         WHERE node.type IN $types
         RETURN node.doc AS doc, score
         LIMIT ${k}`,
        { types: RECALLABLE },
      );
      hits.push(...vectorHits);
    }
  } catch {
    // Index still building, or no OpenAI key: keyword and recent events still answer.
  }

  if (text) {
    try {
      const textHits = await scored(
        `CALL db.idx.fulltext.queryNodes('Event', $text) YIELD node, score
         WHERE node.type IN $types
         RETURN node.doc AS doc, score
         LIMIT ${k}`,
        { text, types: RECALLABLE },
      );
      if (textHits.length > 0) mode = hits.length > 0 ? "hybrid" : "fulltext";
      hits.push(...textHits);
    } catch {
      // Full-text index not ready yet.
    }
  }

  const recent = await docs(
    `MATCH (e:Event)
     WHERE e.type IN $types
     RETURN e.doc AS doc
     ORDER BY e.ts DESC
     LIMIT 4`,
    { types: RECALLABLE },
  );

  const seen = new Set<string>();
  const ranked = [...hits].sort((a, b) => b.score - a.score);
  const chosen = [...ranked, ...recent.map((doc) => ({ ...doc, score: 0 }))].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
  return { mode, events: chosen.slice(0, limit + 4) };
}

export async function eventPaths(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await cypher<{ id: unknown; observer: unknown; place: unknown; item: unknown }>(
    `MATCH (o:Observer)-[:SAW]->(e:Event)
     WHERE e.id IN $ids
     OPTIONAL MATCH (e)-[:ABOUT]->(p:Place)
     OPTIONAL MATCH (e)-[:OF]->(i:Item)
     RETURN e.id AS id, o.id AS observer, p.name AS place, i.name AS item`,
    { ids },
  );
  const paths = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id || paths.has(id)) continue;
    const steps = [
      row.observer ? `Observer ${row.observer}` : null,
      "SAW",
      "Event",
      row.place ? `ABOUT ${row.place}` : null,
      row.item ? `OF ${row.item}` : null,
    ].filter(Boolean);
    paths.set(id, steps.join(" → "));
  }
  return paths;
}
