import { FalkorDB, type Graph, type QueryParams } from "falkordb";

// One FalkorDB graph for the whole mesh. Places, items, observers and events
// are nodes; "who took what from where" is a path, not a join across collections.
const GRAPH_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const globalGraph = globalThis as typeof globalThis & {
  __worldstateGraph?: Promise<Graph>;
  __worldstateSchema?: Promise<void> | null;
};

function graphName() {
  const name = process.env.FALKORDB_GRAPH ?? "worldstate";
  if (!GRAPH_NAME.test(name)) throw new Error("FALKORDB_GRAPH must be a simple name");
  return name;
}

function connect() {
  const url = process.env.FALKORDB_URL;
  return FalkorDB.connect({
    ...(url ? { url } : { host: process.env.FALKORDB_HOST ?? "localhost", port: Number(process.env.FALKORDB_PORT ?? 6390) }),
    username: process.env.FALKORDB_USERNAME || undefined,
    password: process.env.FALKORDB_PASSWORD || undefined,
  });
}

async function worldGraph() {
  globalGraph.__worldstateGraph ??= connect()
    .then((db) => db.selectGraph(graphName()))
    .catch((error) => {
      globalGraph.__worldstateGraph = undefined;
      throw error;
    });
  return globalGraph.__worldstateGraph;
}

/** Cypher that does not wait for indexes. Schema setup uses this. */
export async function cypherRaw<T extends Record<string, unknown>>(
  query: string,
  params?: QueryParams,
): Promise<T[]> {
  const graph = await worldGraph();
  const result = await graph.query<T>(query, params ? { params } : undefined);
  return result.data ?? [];
}

export async function cypher<T extends Record<string, unknown>>(
  query: string,
  params?: QueryParams,
): Promise<T[]> {
  await graphReady();
  return cypherRaw<T>(query, params);
}

export function graphReady() {
  globalGraph.__worldstateSchema ??= ensureSchema().catch((error) => {
    globalGraph.__worldstateSchema = null;
    throw error;
  });
  return globalGraph.__worldstateSchema;
}

async function ignoreExists(query: string) {
  try {
    await cypherRaw(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already indexed|already exists|equivalent index/i.test(message)) return;
    throw error;
  }
}

export const EMBED_DIM = 1536;

export async function ensureSchema() {
  await ignoreExists("CREATE INDEX FOR (e:Event) ON (e.type)");
  await ignoreExists("CREATE INDEX FOR (e:Event) ON (e.ts)");
  await ignoreExists("CREATE INDEX FOR (p:Place) ON (p.key)");
  await ignoreExists("CREATE INDEX FOR (p:Place) ON (p.name)");
  await ignoreExists("CREATE INDEX FOR (f:Frame) ON (f.hash)");
  await ignoreExists("CREATE INDEX FOR (a:Anchor) ON (a.key)");
  await ignoreExists("CREATE INDEX FOR (c:Cache) ON (c.key)");
  await ignoreExists("CREATE INDEX FOR (t:Thing) ON (t.id)");
  await ignoreExists("CREATE INDEX FOR (s:Slot) ON (s.id)");
  await ignoreExists("CREATE INDEX FOR (i:Item) ON (i.name)");
  await ignoreExists(
    `CREATE VECTOR INDEX FOR (e:Event) ON (e.embedding) OPTIONS {dimension:${EMBED_DIM}, similarityFunction:'cosine'}`,
  );
  await ignoreExists("CREATE FULLTEXT INDEX FOR (e:Event) ON (e.summary, e.title)");
  await ignoreExists("CREATE FULLTEXT INDEX FOR (f:Fact) ON (f.text)");
  await ignoreExists("CREATE FULLTEXT INDEX FOR (m:EpisodeMemory) ON (m.content, m.summary)");
}

function listed(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") return Object.keys(value).join(", ");
  return String(value ?? "");
}

export type GraphIndex = { label: string; properties: string; types: string; status: string };

export async function graphStatus() {
  const started = performance.now();
  await cypherRaw("RETURN 1 AS ok");
  const pingMs = Math.round(performance.now() - started);
  let indexes: GraphIndex[] = [];
  try {
    const rows = await cypherRaw<{ label: unknown; properties: unknown; types: unknown; status: unknown }>(
      "CALL db.indexes() YIELD label, properties, types, status RETURN label, properties, types, status",
    );
    indexes = rows.map((row) => ({
      label: String(row.label ?? ""),
      properties: listed(row.properties),
      types: listed(row.types),
      status: String(row.status ?? ""),
    }));
  } catch {
    indexes = [];
  }
  return { graph: graphName(), pingMs, indexes };
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item));
}

export function parseDoc<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function asDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(0);
}

export function asCount(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Finite numbers only, so a vector can be inlined into vecf32([...]). */
export function vecLiteral(values: number[]) {
  if (values.length !== EMBED_DIM || values.some((n) => !Number.isFinite(n))) {
    throw new Error(`embedding must be ${EMBED_DIM} finite numbers`);
  }
  return `vecf32([${values.join(",")}])`;
}

export function fulltextQuery(text: string) {
  const terms = text.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2) ?? [];
  if (terms.length === 0) return null;
  return terms.slice(0, 8).join(" | ");
}

const listeners = new Set<(event: unknown) => void>();

export function publishGraphEvent(event: unknown) {
  for (const listener of listeners) listener(event);
}

export function onGraphEvent(listener: (event: unknown) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
