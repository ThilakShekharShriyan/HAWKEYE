import { asCount, cypher, fulltextQuery, newId, serialize } from "@/lib/graph";
import type { ObserverId } from "@/lib/types";

// Long-term memory lives in the same FalkorDB graph as the places. Facts,
// episodes and vocabulary are nodes the mesh shares, so a question can walk
// from an observer to what they remembered to the place it is about.

const USER_ID = process.env.WORLDSTATE_USER_ID ?? "household";
const DOMAIN = "worldstate";

export function hasAgentMemory() {
  return true;
}

export const observerSession = (observerId: ObserverId) =>
  `observer-${observerId}-${new Date().toISOString().slice(0, 10)}`;

async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (cause) {
    console.warn(`[agent-memory] ${what} failed: ${cause instanceof Error ? cause.message : cause}`);
    return null;
  }
}

export function recordTurn({
  observerId,
  role,
  content,
}: {
  observerId: ObserverId;
  role: "user" | "assistant" | "system";
  content: string;
  modelName?: string;
}) {
  return attempt("recordTurn", () =>
    cypher(
      `CREATE (t:Turn {id: $id, sessionId: $sessionId, role: $role, content: $content, at: $at, observerId: $observerId})
       WITH t
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:SAID]->(t)`,
      {
        id: newId("turn"),
        sessionId: observerSession(observerId),
        role,
        content,
        at: Date.now(),
        observerId,
      },
    ),
  );
}

export function rememberFact({
  label,
  text,
  observerId,
  metadata,
}: {
  label: string;
  text: string;
  observerId: ObserverId;
  metadata?: Record<string, unknown>;
}) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return attempt("saveSemantic", () =>
    cypher(
      `MERGE (f:Fact {label: $label, userId: $userId})
       SET f.text = $text, f.observerId = $observerId, f.at = $at, f.metadata = $metadata
       WITH f
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:REMEMBERED]->(f)`,
      {
        label: slug || "fact",
        userId: USER_ID,
        text,
        observerId,
        at: Date.now(),
        metadata: serialize(metadata ?? {}),
      },
    ),
  );
}

export function rememberEpisode({
  title,
  content,
  summary,
  observerId,
  tags,
  metadata,
}: {
  title: string;
  content: string;
  summary?: string;
  observerId: ObserverId;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  const container = typeof metadata?.container === "string" ? metadata.container : "";
  const id = newId("mem");
  return attempt("saveEpisode", async () => {
    await cypher(
      `CREATE (m:EpisodeMemory {
         id: $id, title: $title, content: $content, summary: $summary,
         observerId: $observerId, at: $at, userId: $userId, tags: $tags
       })
       WITH m
       MERGE (o:Observer {id: $observerId})
       MERGE (o)-[:RECALLS]->(m)`,
      {
        id,
        title,
        content,
        summary: summary ?? "",
        observerId,
        at: Date.now(),
        userId: USER_ID,
        tags: tags ?? [],
      },
    );
    if (!container) return;
    await cypher(
      `MATCH (m:EpisodeMemory {id: $id})
       MATCH (p:Place {kind: 'container', name: $container})
       MERGE (m)-[:ABOUT]->(p)`,
      { id, container },
    );
  });
}

export function defineTerm({
  term,
  definition,
  relatedTerms,
}: {
  term: string;
  definition: string;
  relatedTerms?: string[];
}) {
  return attempt("saveTaxonomic", async () => {
    await cypher(
      `MERGE (t:Term {domain: $domain, term: $term})
       SET t.definition = $definition, t.related = $related`,
      { domain: DOMAIN, term, definition, related: relatedTerms ?? [] },
    );
    await cypher(
      `MATCH (t:Term {domain: $domain, term: $term})
       MATCH (p:Place {kind: 'container', name: $term})
       MERGE (t)-[:DEFINES]->(p)`,
      { domain: DOMAIN, term },
    );
  });
}

export type RecalledContext = {
  text: string;
  counts: Record<string, number>;
  tokens: number;
};

export function recallContext(query: string, observerId: ObserverId, maxTokens = 1200) {
  return attempt<RecalledContext | null>("buildContext", async () => {
    const textQuery = fulltextQuery(query);
    const [facts, episodes, terms, turns] = await Promise.all([
      textQuery
        ? cypher<{ text: unknown }>(
            `CALL db.idx.fulltext.queryNodes('Fact', $text) YIELD node, score
             RETURN node.text AS text
             LIMIT 4`,
            { text: textQuery },
          ).catch(() => [])
        : Promise.resolve([]),
      textQuery
        ? cypher<{ text: unknown }>(
            `CALL db.idx.fulltext.queryNodes('EpisodeMemory', $text) YIELD node, score
             RETURN node.summary AS text
             LIMIT 4`,
            { text: textQuery },
          ).catch(() => [])
        : Promise.resolve([]),
      cypher<{ term: unknown; definition: unknown }>(
        `MATCH (t:Term {domain: $domain}) RETURN t.term AS term, t.definition AS definition LIMIT 8`,
        { domain: DOMAIN },
      ).catch(() => []),
      cypher<{ role: unknown; content: unknown }>(
        `MATCH (t:Turn {sessionId: $sessionId})
         RETURN t.role AS role, t.content AS content
         ORDER BY t.at DESC
         LIMIT 4`,
        { sessionId: observerSession(observerId) },
      ).catch(() => []),
    ]);

    const lines = [
      ...facts.map((row) => `Fact: ${row.text}`),
      ...episodes.map((row) => `Episode: ${row.text}`),
      ...terms.map((row) => `Term ${row.term}: ${row.definition}`),
      ...turns.reverse().map((row) => `${row.role}: ${row.content}`),
    ].filter((line) => !line.endsWith(": ") && !line.endsWith(": undefined") && !line.endsWith(": null"));
    if (lines.length === 0) return null;
    const text = lines.join("\n").slice(0, Math.max(200, maxTokens * 4));
    return {
      text,
      counts: { facts: facts.length, episodes: episodes.length, terms: terms.length, turns: turns.length },
      tokens: Math.ceil(text.length / 4),
    };
  });
}

export async function agentMemoryStatus() {
  const started = performance.now();
  try {
    const [facts, episodes, terms] = await Promise.all([
      cypher<{ n: unknown }>("MATCH (f:Fact) RETURN count(f) AS n"),
      cypher<{ n: unknown }>("MATCH (m:EpisodeMemory) RETURN count(m) AS n"),
      cypher<{ n: unknown }>("MATCH (t:Term) RETURN count(t) AS n"),
    ]);
    return {
      configured: true as const,
      ok: true,
      store: "falkordb",
      counts: {
        facts: asCount(facts[0]?.n),
        episodes: asCount(episodes[0]?.n),
        terms: asCount(terms[0]?.n),
      },
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (cause) {
    return {
      configured: true as const,
      ok: false,
      store: "falkordb",
      error: cause instanceof Error ? cause.message.slice(0, 200) : String(cause),
    };
  }
}
