// Seeds a shared-house demo into FalkorDB: a fridge and a snack shelf, plus
// what the cameras saw leave them. Safe to rerun: it replaces only places this
// seed created (marked in their description) and refuses to touch a real
// checkpoint with the same name.
//   npm run seed:demo
import { insertEvent } from "../lib/events-repo.ts";
import { createPlace, deletePlace, findPlaceByName } from "../lib/world-store.ts";
import type { ObserverId } from "../lib/types.ts";

const DEMO_MARK = "[demo seed] ";
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const places: { name: string; place: string; description: string; items: { name: string; count: number; since: Date; by: ObserverId }[] }[] = [
  {
    name: "fridge",
    place: "kitchen",
    description: `${DEMO_MARK}The shared kitchen fridge.`,
    items: [
      { name: "egg", count: 4, since: ago(300), by: "01" },
      { name: "milk", count: 1, since: ago(200), by: "02" },
      { name: "coke can", count: 2, since: ago(90), by: "01" },
    ],
  },
  {
    name: "snack shelf",
    place: "living room",
    description: `${DEMO_MARK}The shelf by the door where the house keeps snacks.`,
    items: [
      { name: "granola bar", count: 3, since: ago(120), by: "02" },
      { name: "chips", count: 1, since: ago(60), by: "01" },
    ],
  },
];

for (const p of places) {
  const existing = await findPlaceByName(p.name);
  if (existing && !existing.description?.startsWith(DEMO_MARK)) {
    console.error(`"${p.name}" is a real checkpoint, not demo data. Not touching it; rename or delete it first.`);
    process.exit(1);
  }
  if (existing) await deletePlace(p.name);
  await createPlace({
    key: `container:${p.name}`,
    kind: "container",
    name: p.name,
    place: p.place,
    catalogued: true,
    description: p.description,
    items: p.items,
    lastSeen: now,
    lastObserver: "01",
  });
}

const events: { observer: ObserverId; where: string; object: string; detail: string; minutes: number; summary: string }[] = [
  { observer: "02", where: "fridge", object: "coke can", detail: "3 → 2", minutes: 8, summary: "Observer 02 saw 1 coke can taken from the fridge; 2 left." },
  { observer: "01", where: "fridge", object: "egg", detail: "6 → 4", minutes: 45, summary: "Observer 01 saw 2 eggs taken from the fridge; 4 left." },
  { observer: "02", where: "snack shelf", object: "granola bar", detail: "4 → 3", minutes: 20, summary: "Observer 02 saw 1 granola bar taken from the snack shelf; 3 left." },
];
for (const e of events) {
  await insertEvent({
    type: "transition",
    observerId: e.observer,
    title: "Taken",
    location: [places.find((p) => p.name === e.where)!.place, e.where],
    metadata: { object: e.object, from: e.where, detail: e.detail },
    ts: ago(e.minutes),
    summary: e.summary,
  });
}
console.log(`seeded ${places.length} places and ${events.length} events`);
process.exit(0);
