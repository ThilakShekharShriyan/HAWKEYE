import { cypher } from "@/lib/graph";
import { HOUSE_EVENTS, isSeedOwned } from "@/lib/house-graph";
import { deletePlace, listPlaceDocs } from "@/lib/world-store";

// Puts the graph back to the seeded house before a demo, so a place registered
// on stage is the only new thing in it. Keeps the house, roommates, areas,
// seeded sites and their sample history; removes what the cameras and the voice
// assistant added: camera-made places (with their anchors, episodes, things and
// events), other events, visual anchors, frames, perception cache, and the
// assistant's conversation memory.

const MEMORY_LABELS = ["Turn", "Fact", "EpisodeMemory", "Term", "Episode", "Frame", "Cache", "Anchor"];

export type ResetPlan = {
  places: string[];
  events: number;
  memory: Record<string, number>;
};

const keepSummaries = () => HOUSE_EVENTS.map((event) => event.summary);

export async function planReset(): Promise<ResetPlan> {
  const places = (await listPlaceDocs(500)).filter((doc) => doc.kind === "container" && !isSeedOwned(doc)).map((doc) => doc.name);
  const [{ n: events }] = await cypher<{ n: unknown }>(`MATCH (e:Event) WHERE NOT e.summary IN $keep RETURN count(e) AS n`, { keep: keepSummaries() });
  const memory: Record<string, number> = {};
  for (const label of MEMORY_LABELS) {
    const [{ n }] = await cypher<{ n: unknown }>(`MATCH (n:${label}) RETURN count(n) AS n`);
    memory[label] = Number(n);
  }
  return { places, events: Number(events), memory };
}

export async function applyReset(plan: ResetPlan) {
  for (const name of plan.places) await deletePlace(name);
  await cypher(`MATCH (e:Event) WHERE NOT e.summary IN $keep DETACH DELETE e`, { keep: keepSummaries() });
  for (const label of MEMORY_LABELS) await cypher(`MATCH (n:${label}) DETACH DELETE n`);
  // Camera sightings of seeded sites are gone with their events; so are the phone links they made.
  await cypher(`MATCH (:Observer)-[w:WATCHES]->(:Place) DELETE w`);
}
