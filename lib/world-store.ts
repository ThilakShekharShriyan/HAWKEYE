import type { QueryParams } from "falkordb";
import { asCount, asDate, cypher, newId, parseDoc, serialize } from "@/lib/graph";
import type { ContainerDoc } from "@/lib/perception";
import type { ObserverId } from "@/lib/types";

function revivePlace(raw: ContainerDoc): ContainerDoc {
  return {
    ...raw,
    lastSeen: asDate(raw.lastSeen),
    observedAt: raw.observedAt ? asDate(raw.observedAt) : undefined,
    items: (raw.items ?? []).map((item) => ({ ...item, since: asDate(item.since) })),
    references: raw.references?.map((reference) => ({ ...reference, at: asDate(reference.at) })),
    lastChange: raw.lastChange ? { ...raw.lastChange, at: asDate(raw.lastChange.at) } : undefined,
  };
}

function readPlace(value: unknown) {
  const doc = parseDoc<ContainerDoc>(value);
  return doc ? revivePlace(doc) : null;
}

async function placeRows(query: string, params?: QueryParams) {
  const rows = await cypher<{ doc: unknown }>(query, params);
  return rows.flatMap((row) => {
    const doc = readPlace(row.doc);
    return doc ? [doc] : [];
  });
}

async function writePlace(doc: ContainerDoc) {
  const saved: ContainerDoc = { ...doc, lastSeen: asDate(doc.lastSeen) };
  await cypher(
    `MERGE (p:Place {key: $key})
     SET p.kind = 'container', p.name = $name, p.mark = $mark, p.lastSeen = $lastSeen, p.doc = $doc`,
    {
      key: saved.key,
      name: saved.name,
      mark: saved.mark ?? "",
      lastSeen: saved.lastSeen.getTime(),
      doc: serialize(saved),
    },
  );
  await syncHolds(saved);
}

async function syncHolds(doc: ContainerDoc) {
  await cypher(`MATCH (p:Place {key: $key}) OPTIONAL MATCH (p)-[h:HOLDS]->() DELETE h`, { key: doc.key });
  for (const item of doc.items ?? []) {
    await cypher(
      `MATCH (p:Place {key: $key})
       MERGE (i:Item {name: $name})
       MERGE (p)-[r:HOLDS]->(i)
       SET r.count = $count, r.since = $since, r.by = $by`,
      {
        key: doc.key,
        name: item.name,
        count: item.count,
        since: asDate(item.since).getTime(),
        by: item.by,
      },
    );
  }
  if (doc.lastObserver) {
    await cypher(
      `MATCH (p:Place {key: $key})
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:WATCHES]->(p)`,
      { key: doc.key, observerId: doc.lastObserver },
    );
  }
}

export async function listPlaceDocs(limit = 100) {
  return placeRows(
    `MATCH (p:Place {kind: 'container'})
     RETURN p.doc AS doc
     ORDER BY p.lastSeen DESC
     LIMIT ${Math.floor(limit)}`,
  );
}

export async function findPlace(key: string) {
  const [doc] = await placeRows(`MATCH (p:Place {key: $key}) RETURN p.doc AS doc LIMIT 1`, { key });
  return doc ?? null;
}

export async function findPlaceByName(name: string) {
  const [doc] = await placeRows(
    `MATCH (p:Place {kind: 'container', name: $name}) RETURN p.doc AS doc LIMIT 1`,
    { name },
  );
  return doc ?? null;
}

export async function findRecentPlace(excludeKeys: string[], since: Date) {
  const rows = await cypher<{ name: unknown }>(
    `MATCH (p:Place {kind: 'container'})
     WHERE NOT p.key IN $keys AND p.lastSeen >= $since
     RETURN p.name AS name
     ORDER BY p.lastSeen DESC
     LIMIT 1`,
    { keys: excludeKeys, since: since.getTime() },
  );
  const name = rows[0]?.name;
  return typeof name === "string" && name ? { name } : null;
}

// Each place is read, merged and rewritten (doc plus HOLDS edges) in several
// queries; two phones reporting the same shelf at once would otherwise lose
// one another's changes. One chain of promises per key keeps them in turn.
const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  keyLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (keyLocks.get(key) === tail) keyLocks.delete(key);
  }
}

export async function createPlace(doc: ContainerDoc) {
  await withKeyLock(doc.key, async () => {
    if (await findPlace(doc.key)) return;
    await writePlace(doc);
  });
}

export async function patchPlace(key: string, patch: Partial<ContainerDoc>) {
  await withKeyLock(key, async () => {
    const current = await findPlace(key);
    if (!current) return;
    await writePlace({ ...current, ...patch, key });
  });
}

export type StoredEpisode = {
  id: string;
  observerId: string;
  trigger: string;
  container: string | null;
  startedAt: Date;
  endedAt?: Date;
  frameHashes: string[];
  changes: string[];
  tokens?: number;
  identityConfidence?: number;
};

export async function insertEpisode(record: Omit<StoredEpisode, "id"> & Record<string, unknown>) {
  const id = newId("ep");
  const doc = { ...record, id, startedAt: asDate(record.startedAt) };
  await cypher(
    `CREATE (ep:Episode {id: $id, container: $container, startedAt: $startedAt, doc: $doc})`,
    {
      id,
      container: doc.container ?? "",
      startedAt: doc.startedAt.getTime(),
      doc: serialize(doc),
    },
  );
  if (doc.container) {
    await cypher(
      `MATCH (ep:Episode {id: $id})
       MATCH (p:Place {kind: 'container', name: $container})
       MERGE (ep)-[:OF]->(p)`,
      { id, container: doc.container },
    );
  }
  if (doc.observerId) {
    await cypher(
      `MATCH (ep:Episode {id: $id})
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:CAPTURED]->(ep)`,
      { id, observerId: doc.observerId },
    );
  }
  const hashes = (doc.frameHashes ?? []).filter((hash) => typeof hash === "string");
  if (hashes.length > 0) {
    await cypher(
      `MATCH (ep:Episode {id: $id})
       UNWIND $hashes AS hash
       MATCH (f:Frame {hash: hash})
       MERGE (ep)-[:INCLUDES]->(f)`,
      { id, hashes },
    ).catch(() => {});
  }
  return id;
}

export async function episodesFor(container: string, limit: number): Promise<StoredEpisode[]> {
  const rows = await cypher<{ doc: unknown }>(
    `MATCH (ep:Episode {container: $container})
     RETURN ep.doc AS doc
     ORDER BY ep.startedAt DESC
     LIMIT ${Math.floor(limit)}`,
    { container },
  );
  return rows.flatMap((row) => {
    const doc = parseDoc<StoredEpisode>(row.doc);
    if (!doc) return [];
    return [{ ...doc, startedAt: asDate(doc.startedAt), endedAt: doc.endedAt ? asDate(doc.endedAt) : undefined }];
  });
}

export async function saveFrame(frame: {
  hash: string;
  observerId: ObserverId;
  ts: Date;
  phase: string;
  phash?: string;
  image: string;
  expireAt: Date;
}) {
  await cypher(
    `MERGE (f:Frame {hash: $hash})
     ON CREATE SET f.observerId = $observerId, f.ts = $ts, f.phase = $phase, f.phash = $phash, f.image = $image, f.expireAt = $expireAt`,
    {
      hash: frame.hash,
      observerId: frame.observerId,
      ts: frame.ts.getTime(),
      phase: frame.phase,
      phash: frame.phash ?? "",
      image: frame.image,
      expireAt: frame.expireAt.getTime(),
    },
  );
}

export async function framesPresent(hashes: string[]) {
  if (hashes.length === 0) return new Set<string>();
  const rows = await cypher<{ hash: unknown }>(
    `MATCH (f:Frame)
     WHERE f.hash IN $hashes AND f.expireAt > $now
     RETURN f.hash AS hash`,
    { hashes, now: Date.now() },
  );
  return new Set(rows.map((row) => String(row.hash)));
}

export async function frameImage(hash: string) {
  const rows = await cypher<{ image: unknown }>(
    `MATCH (f:Frame {hash: $hash})
     WHERE f.expireAt > $now
     RETURN f.image AS image
     LIMIT 1`,
    { hash, now: Date.now() },
  );
  const image = rows[0]?.image;
  return typeof image === "string" && image ? image : null;
}

export async function privacyActive(observerId: string, now = new Date()) {
  const rows = await cypher<{ id: unknown }>(
    `MATCH (w:Privacy {observerId: $observerId})
     WHERE w.start <= $now AND w.end > $now
     RETURN w.id AS id
     LIMIT 1`,
    { observerId, now: now.getTime() },
  );
  return rows.length > 0;
}

export async function startPrivacy(observerId: string, start: Date, end: Date) {
  await cypher(
    `CREATE (:Privacy {id: $id, observerId: $observerId, start: $start, end: $end})`,
    { id: newId("priv"), observerId, start: start.getTime(), end: end.getTime() },
  );
}

export async function countAnchors() {
  const rows = await cypher<{ n: unknown }>(`MATCH (a:Anchor) RETURN count(a) AS n`);
  return asCount(rows[0]?.n);
}

export async function deletePlace(name: string) {
  const site = await findPlaceByName(name);
  if (!site) return null;
  const [anchors, episodes, events] = await Promise.all([
    cypher<{ n: unknown }>(
      `MATCH (a:Anchor) WHERE a.name = $name OR a.container = $name RETURN count(a) AS n`,
      { name },
    ),
    cypher<{ n: unknown }>(`MATCH (ep:Episode {container: $name}) RETURN count(ep) AS n`, { name }),
    cypher<{ n: unknown }>(
      `MATCH (e:Event)
       WHERE $name IN coalesce(e.location, []) OR e.metaFrom = $name OR e.metaTo = $name OR e.metaObject = $name
       RETURN count(e) AS n`,
      { name },
    ),
  ]);
  await cypher(
    `MATCH (p:Place {kind: 'container', name: $name})
     OPTIONAL MATCH (p)-[:HAS_SLOT]->(s:Slot)
     OPTIONAL MATCH (s)<-[:IN]-(live:Thing)
     OPTIONAL MATCH (gone:Thing)-[:WAS_IN]->(p)
     DETACH DELETE live, gone, s`,
    { name },
  );
  await cypher(`MATCH (p:Place {kind: 'container', name: $name}) DETACH DELETE p`, { name });
  await cypher(`MATCH (a:Anchor) WHERE a.name = $name OR a.container = $name DETACH DELETE a`, { name });
  await cypher(`MATCH (ep:Episode {container: $name}) DETACH DELETE ep`, { name });
  await cypher(
    `MATCH (e:Event)
     WHERE $name IN coalesce(e.location, []) OR e.metaFrom = $name OR e.metaTo = $name OR e.metaObject = $name
     DETACH DELETE e`,
    { name },
  );
  await cypher(
    `MATCH (i:Item)
     WHERE NOT ()-[:HOLDS]->(i) AND NOT ()-[:OF]->(i) AND NOT ()-[:KIND]->(i) AND NOT (i)-[:RESTOCK_FROM]->()
     DELETE i`,
  );
  return {
    site: 1,
    anchors: asCount(anchors[0]?.n),
    episodes: asCount(episodes[0]?.n),
    events: asCount(events[0]?.n),
  };
}

export type AnchorRecord = {
  key: string;
  kind: "anchor";
  name: string;
  container: string;
  description: string;
  references: { embedding: number[]; hash: string; observerId: ObserverId; at: string }[];
  observerId: ObserverId;
  createdAt: string;
  updatedAt: string;
};

export async function listAnchorRecords() {
  const rows = await cypher<{ doc: unknown }>(
    `MATCH (a:Anchor) RETURN a.doc AS doc ORDER BY a.updatedAt DESC`,
  );
  return rows.flatMap((row) => {
    const doc = parseDoc<AnchorRecord>(row.doc);
    return doc ? [doc] : [];
  });
}

export async function saveAnchorRecord(record: AnchorRecord) {
  await cypher(
    `MERGE (a:Anchor {key: $key})
     SET a.name = $name, a.container = $container, a.updatedAt = $updatedAt, a.doc = $doc`,
    {
      key: record.key,
      name: record.name,
      container: record.container,
      updatedAt: asDate(record.updatedAt).getTime(),
      doc: serialize(record),
    },
  );
  await cypher(
    `MATCH (a:Anchor {key: $key})
     MERGE (o:Observer {id: $observerId})
     MERGE (o)-[:REMEMBERED]->(a)`,
    { key: record.key, observerId: record.observerId },
  );
  await cypher(
    `MATCH (a:Anchor {key: $key})
     MATCH (p:Place {kind: 'container', name: $container})
     MERGE (a)-[:MARKS]->(p)`,
    { key: record.key, container: record.container },
  );
}

export async function cacheRead<T>(key: string): Promise<{ perceived: T; model: string } | null> {
  const rows = await cypher<{ doc: unknown }>(
    `MATCH (c:Cache {key: $key})
     WHERE c.expireAt > $now
     SET c.hits = coalesce(c.hits, 0) + 1, c.at = $now
     RETURN c.doc AS doc`,
    { key, now: Date.now() },
  );
  const doc = parseDoc<{ perceived: T; model: string }>(rows[0]?.doc);
  if (!doc?.model) return null;
  return { perceived: doc.perceived, model: doc.model };
}

const PURGE_EVERY_MS = 10 * 60 * 1000;
let lastPurge = 0;

/** Expired Cache nodes are ignored on read; delete them now and then so they do not pile up. */
async function purgeExpiredCache() {
  const now = Date.now();
  if (now - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now;
  await cypher(`MATCH (c:Cache) WHERE c.expireAt <= $now DELETE c`, { now }).catch(() => {});
}

export async function cacheWrite<T>(key: string, promptVersion: string, perceived: T, model: string, expireAt: Date) {
  void purgeExpiredCache();
  await cypher(
    `MERGE (c:Cache {key: $key})
     ON CREATE SET c.hits = 0
     SET c.promptVersion = $promptVersion, c.expireAt = $expireAt, c.at = $now, c.doc = $doc`,
    {
      key,
      promptVersion,
      expireAt: expireAt.getTime(),
      now: Date.now(),
      doc: serialize({ perceived, model }),
    },
  );
}

export async function recordMetric(model: string, input: number, output: number, ts = new Date()) {
  await cypher(
    `CREATE (:Usage {id: $id, ts: $ts, model: $model, input: $input, output: $output})`,
    { id: newId("use"), ts: ts.getTime(), model, input, output },
  );
}

export async function metricsSince(since: Date) {
  const rows = await cypher<{ model: unknown; calls: unknown; input: unknown; output: unknown }>(
    `MATCH (m:Usage)
     WHERE m.ts >= $since
     RETURN m.model AS model, count(m) AS calls, sum(m.input) AS input, sum(m.output) AS output`,
    { since: since.getTime() },
  );
  return rows.map((row) => ({
    model: String(row.model ?? ""),
    calls: asCount(row.calls),
    input: asCount(row.input),
    output: asCount(row.output),
  }));
}
