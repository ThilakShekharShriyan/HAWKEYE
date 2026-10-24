// Seeds the shared-house demo into FalkorDB: two roommates, the areas and sites
// they share (kitchen appliances, laundry and household supplies), what each
// site holds, who is responsible for what, and a few things the cameras saw leave.
// Safe to rerun: it replaces only places this seed created (marked in their
// description) and refuses to touch a real checkpoint with the same name.
//   npm run seed:demo
import { insertEvent } from "../lib/events-repo.ts";
import { attachSite, HOUSE, HOUSE_MARK, seedHouseStructure } from "../lib/house-graph.ts";
import type { ObserverId } from "../lib/types.ts";
import { createPlace, deletePlace, findPlaceByName } from "../lib/world-store.ts";

const LEGACY_MARK = "[demo seed] ";
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const owned = (description?: string) =>
  Boolean(description && (description.startsWith(HOUSE_MARK) || description.startsWith(LEGACY_MARK)));

// The earlier two-place demo: remove it if it is still ours.
for (const legacy of ["snack shelf"]) {
  const existing = await findPlaceByName(legacy);
  if (existing && owned(existing.description)) await deletePlace(legacy);
}

await seedHouseStructure();

let sites = 0;
for (const area of HOUSE.areas) {
  for (const site of area.sites) {
    const existing = await findPlaceByName(site.name);
    if (existing && !owned(existing.description)) {
      console.error(`"${site.name}" is a real checkpoint, not demo data. Not touching it; rename or delete it first.`);
      process.exit(1);
    }
    if (existing) await deletePlace(site.name);
    const key = `container:${site.name}`;
    await createPlace({
      key,
      kind: "container",
      name: site.name,
      place: area.name.toLowerCase(),
      catalogued: true,
      description: `${HOUSE_MARK}The ${site.name} in the ${area.name.toLowerCase()}.`,
      items: site.items.map((item, index) => ({
        ...item,
        since: ago(300 - index * 40),
        by: HOUSE.people[index % HOUSE.people.length].observer as ObserverId,
      })),
      lastSeen: now,
      lastObserver: "01",
    });
    await attachSite(area.id, key);
    sites++;
  }
}

// What the cameras saw leave. The observer is the camera that saw it (each
// roommate's phone), not an identified taker.
const events: { observer: ObserverId; area: string; site: string; object: string; detail: string; minutes: number; summary: string }[] = [
  { observer: "02", area: "kitchen", site: "fridge", object: "coke can", detail: "3 → 2", minutes: 8, summary: "Observer 02 saw 1 coke can taken from the fridge; 2 left." },
  { observer: "01", area: "kitchen", site: "fridge", object: "egg", detail: "6 → 4", minutes: 45, summary: "Observer 01 saw 2 eggs taken from the fridge; 4 left." },
  { observer: "02", area: "household", site: "household shelf", object: "bounty", detail: "4 → 3", minutes: 20, summary: "Observer 02 saw 1 bounty taken from the household shelf; 3 left." },
];
for (const e of events) {
  await insertEvent({
    type: "transition",
    observerId: e.observer,
    title: "Taken",
    location: [e.area, e.site],
    metadata: { object: e.object, from: e.site, detail: e.detail },
    summary: e.summary,
    ts: ago(e.minutes),
  });
}
console.log(`seeded the house: ${HOUSE.people.length} roommates, ${HOUSE.areas.length} areas, ${sites} sites, ${events.length} events`);
process.exit(0);
