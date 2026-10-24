import type { Graph } from "./db";

// Sample conference data. Replace/extend with live data (e.g. Bright Data scrape) via `npm run ingest`.
const people = [
  { id: "me", name: "You", role: "Attendee", company: "Hackathon Team", interests: ["graph-databases", "ai-agents", "code-review"] },
  { id: "ana", name: "Ana Ruiz", role: "Staff Engineer", company: "FalkorDB", interests: ["graph-databases", "agent-memory"] },
  { id: "ben", name: "Ben Okafor", role: "DevRel", company: "Qodo", interests: ["code-review", "ai-agents"] },
  { id: "cat", name: "Cat Nguyen", role: "Founder", company: "Simulithic", interests: ["ai-agents", "robotics"] },
  { id: "dev", name: "Dev Patel", role: "Data Engineer", company: "Meta", interests: ["graph-databases", "data-pipelines"] },
  { id: "eli", name: "Eli Sato", role: "Platform Eng", company: "Netflix", interests: ["observability", "data-pipelines"] },
];

const topics = ["graph-databases", "ai-agents", "agent-memory", "code-review", "robotics", "data-pipelines", "observability"];

const slots = [
  { id: "s1", label: "10:00" },
  { id: "s2", label: "11:00" },
  { id: "s3", label: "13:00" },
  { id: "s4", label: "14:00" },
];

const talks = [
  { id: "t1", title: "Memory for Long-Running Agents", speaker: "ana", slot: "s1", topics: ["agent-memory", "ai-agents"] },
  { id: "t2", title: "Reviewing AI-Written Code at Scale", speaker: "ben", slot: "s1", topics: ["code-review", "ai-agents"] },
  { id: "t3", title: "Graphs Beyond Social Networks", speaker: "dev", slot: "s2", topics: ["graph-databases"] },
  { id: "t4", title: "Robots Need Shared State", speaker: "cat", slot: "s3", topics: ["robotics", "ai-agents"] },
  { id: "t5", title: "Streaming Pipelines Without Tears", speaker: "eli", slot: "s3", topics: ["data-pipelines", "observability"] },
  { id: "t6", title: "Multi-Hop Questions with Cypher", speaker: "ana", slot: "s4", topics: ["graph-databases"] },
];

export async function seed(graph: Graph) {
  await graph.query("MATCH (n) DETACH DELETE n");
  for (const idx of ["Person", "Talk", "Topic", "Company", "Slot"]) {
    try { await graph.query(`CREATE INDEX FOR (n:${idx}) ON (n.id)`); } catch { /* index exists */ }
  }
  for (const t of topics) await graph.query("MERGE (:Topic {id: $id})", { params: { id: t } });
  for (const s of slots) await graph.query("MERGE (:Slot {id: $id, label: $label})", { params: s });
  for (const p of people) {
    await graph.query(
      `MERGE (c:Company {id: $company})
       MERGE (p:Person {id: $id}) SET p.name = $name, p.role = $role
       MERGE (p)-[:WORKS_AT]->(c)`,
      { params: { id: p.id, name: p.name, role: p.role, company: p.company } },
    );
    for (const t of p.interests) {
      await graph.query(
        "MATCH (p:Person {id: $p}), (t:Topic {id: $t}) MERGE (p)-[:INTERESTED_IN]->(t)",
        { params: { p: p.id, t } },
      );
    }
  }
  for (const t of talks) {
    await graph.query(
      `MATCH (sp:Person {id: $speaker}), (s:Slot {id: $slot})
       MERGE (k:Talk {id: $id}) SET k.title = $title
       MERGE (sp)-[:PRESENTS]->(k) MERGE (k)-[:IN_SLOT]->(s)`,
      { params: { id: t.id, title: t.title, speaker: t.speaker, slot: t.slot } },
    );
    for (const topic of t.topics) {
      await graph.query(
        "MATCH (k:Talk {id: $k}), (t:Topic {id: $t}) MERGE (k)-[:ABOUT]->(t)",
        { params: { k: t.id, t: topic } },
      );
    }
  }
}
