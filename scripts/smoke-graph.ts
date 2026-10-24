// Live check of the FalkorDB path: write a place and a "taken" event, read
// them back, then delete the place. Run with FalkorDB up:
//   npx vite-node --config vitest.config.ts scripts/smoke-graph.ts
import { insertEvent, searchEvents } from "../lib/events-repo.ts";
import { graphStatus } from "../lib/graph.ts";
import { retrieveMemories } from "../lib/memory.ts";
import { createPlace, deletePlace, findPlaceByName, listPlaceDocs } from "../lib/world-store.ts";

const name = `smoke-table-${Date.now().toString(36)}`;
const now = new Date();

const status = await graphStatus();
console.log(`graph ${status.graph} ping ${status.pingMs}ms indexes ${status.indexes.length}`);

await createPlace({
  key: `container:${name}`,
  kind: "container",
  name,
  place: "kitchen",
  catalogued: true,
  description: `The ${name} holds coke cans.`,
  items: [{ name: "coke can", count: 2, since: now, by: "01" }],
  lastSeen: now,
  lastObserver: "01",
});

await insertEvent({
  type: "transition",
  observerId: "02",
  title: "Taken",
  location: ["kitchen", name],
  metadata: { object: "coke can", from: name, to: "Arnav", detail: "3 → 2" },
  summary: `Arnav took 1 coke can from the ${name}; 2 left.`,
});

const place = await findPlaceByName(name);
const holds = place?.items.map((item) => `${item.name}×${item.count}`).join(", ");
const { mode, memories } = await retrieveMemories("who took the coke can");
const searched = await searchEvents("coke can", 5);
const removed = await deletePlace(name);
const left = (await listPlaceDocs()).filter((doc) => doc.name === name);

const path = memories.find((memory) => memory.text.includes(name))?.path;
const ok =
  holds === "coke can×2" &&
  searched.events.some((event) => event.summary.includes(name)) &&
  removed?.site === 1 &&
  removed.events >= 1 &&
  left.length === 0;

console.log(
  JSON.stringify(
    {
      ok,
      holds,
      retrieval: mode,
      path: path ?? null,
      removed,
      left: left.length,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
