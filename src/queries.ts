import type { Graph } from "./db";

export interface PersonMatch {
  id: string;
  name: string;
  role: string;
  company: string;
  sharedTopics: string[];
  why: string;
}

export interface TalkPick {
  id: string;
  title: string;
  slot: string;
  topics: string[];
  why: string;
}

const rows = (r: { data?: unknown }) => (r.data ?? []) as Record<string, any>[];

/** Multi-hop: me -INTERESTED_IN-> topic <-INTERESTED_IN- person, skipping people I've already met. */
export async function whoToMeet(graph: Graph, me: string, limit = 5): Promise<PersonMatch[]> {
  const res = await graph.query(
    `MATCH (m:Person {id: $me})-[:INTERESTED_IN]->(t:Topic)<-[:INTERESTED_IN]-(o:Person)-[:WORKS_AT]->(c:Company)
     WHERE o.id <> m.id AND NOT (m)-[:MET]-(o)
     WITH o, c, collect(t.id) AS shared
     RETURN o.id AS id, o.name AS name, o.role AS role, c.id AS company, shared
     ORDER BY size(shared) DESC, name LIMIT $limit`,
    { params: { me, limit } },
  );
  return rows(res).map((r) => ({
    ...(r as Omit<PersonMatch, "sharedTopics" | "why">),
    sharedTopics: r.shared,
    why: `You and ${r.name} (${r.company}) both care about ${r.shared.join(", ")}`,
  }));
}

/** Talks on my topics that don't clash with a slot I already plan to attend. */
export async function recommendTalks(graph: Graph, me: string, limit = 5): Promise<TalkPick[]> {
  const res = await graph.query(
    `MATCH (m:Person {id: $me})-[:INTERESTED_IN]->(t:Topic)<-[:ABOUT]-(k:Talk)-[:IN_SLOT]->(s:Slot)
     WHERE NOT (m)-[:PLANS_TO_ATTEND]->(k)
     OPTIONAL MATCH (m)-[:PLANS_TO_ATTEND]->(busy:Talk)-[:IN_SLOT]->(s)
     WITH k, s, t, busy WHERE busy IS NULL
     WITH k, s, collect(t.id) AS matched
     RETURN k.id AS id, k.title AS title, s.label AS slot, matched
     ORDER BY size(matched) DESC, slot LIMIT $limit`,
    { params: { me, limit } },
  );
  return rows(res).map((r) => ({
    id: r.id,
    title: r.title,
    slot: r.slot,
    topics: r.matched,
    why: `Matches your interest in ${r.matched.join(", ")}`,
  }));
}

/** Shared state: any agent (planner, networker) writes the plan into the same graph. */
export async function planTalk(graph: Graph, me: string, talk: string, agent: string) {
  await graph.query(
    `MATCH (m:Person {id: $me}), (k:Talk {id: $talk})
     MERGE (m)-[r:PLANS_TO_ATTEND]->(k) SET r.by = $agent`,
    { params: { me, talk, agent } },
  );
}

/** Memory across sessions: remember who I met and what we talked about. */
export async function recordMeeting(graph: Graph, me: string, other: string, note: string) {
  await graph.query(
    `MATCH (a:Person {id: $me}), (b:Person {id: $other})
     MERGE (a)-[r:MET]->(b) SET r.note = $note, r.at = timestamp()`,
    { params: { me, other, note } },
  );
}

export async function recall(graph: Graph, me: string) {
  const res = await graph.query(
    `MATCH (:Person {id: $me})-[r:MET]->(o:Person)
     RETURN o.name AS name, r.note AS note, r.at AS at ORDER BY at DESC`,
    { params: { me } },
  );
  return rows(res) as { name: string; note: string; at: number }[];
}
