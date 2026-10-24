// Seeds the shared-house demo into FalkorDB: two roommates, the areas and sites
// they share (kitchen appliances, laundry and household supplies), what each
// site holds, who is responsible for what, and a few things the cameras saw leave.
//
// Safe to rerun and safe next to real data:
//  - it first checks every site name, and writes nothing if one belongs to a real
//    checkpoint;
//  - it recognises its own places by a `seed` field that camera updates keep
//    (and by the older description markers), and resets those in place, so
//    observations, anchors and events gathered at them are kept;
//  - it adds its sample events once.
//   npm run seed:demo
import { insertEvent } from "../lib/events-repo.ts";
import { cypher } from "../lib/graph.ts";
import { attachSite, HOUSE, HOUSE_EVENTS, HOUSE_MARK, isSeedOwned, seedHouseStructure } from "../lib/house-graph.ts";
import type { ContainerDoc } from "../lib/perception.ts";
import type { ObserverId } from "../lib/types.ts";
import { createPlace, deletePlace, findPlaceByName, patchPlace } from "../lib/world-store.ts";

const LEGACY_SITES = ["snack shelf"]; // the earlier two-place demo
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const owned = (doc: ContainerDoc) => isSeedOwned(doc);

// Preflight: look at every name before changing anything.
const names = [...HOUSE.areas.flatMap((area) => area.sites.map((site) => site.name)), ...LEGACY_SITES];
const existing = new Map<string, ContainerDoc>();
const conflicts: string[] = [];
for (const name of names) {
  const doc = await findPlaceByName(name);
  if (!doc) continue;
  existing.set(name, doc);
  if (!owned(doc)) conflicts.push(name);
}
if (conflicts.length > 0) {
  console.error(
    `Not seeding: ${conflicts.map((name) => `"${name}"`).join(", ")} ${conflicts.length > 1 ? "are real checkpoints" : "is a real checkpoint"}, not demo data. Rename or delete ${conflicts.length > 1 ? "them" : "it"} first. Nothing was changed.`,
  );
  process.exit(1);
}

// The old two-place demo goes away: this is the one explicit cleanup.
for (const legacy of LEGACY_SITES) if (existing.has(legacy)) await deletePlace(legacy);

await seedHouseStructure();

let sites = 0;
for (const area of HOUSE.areas) {
  for (const site of area.sites) {
    const key = `container:${site.name}`;
    const items = site.items.map((item, index) => ({
      ...item,
      since: ago(300 - index * 40),
      by: HOUSE.people[index % HOUSE.people.length].observer as ObserverId,
    }));
    const description = `${HOUSE_MARK}The ${site.name} in the ${area.name.toLowerCase()}.`;
    if (existing.has(site.name)) {
      // Reset the demo inventory in place; observations and history stay.
      await patchPlace(existing.get(site.name)!.key, {
        place: area.name.toLowerCase(),
        catalogued: true,
        items,
        description,
        seed: "house",
        // lastSeen is left alone: bumping it would push places a camera saw since
        // out of the recent candidates perception compares a sighting against.
      }, { watch: false });
    } else {
      await createPlace({
        key,
        kind: "container",
        name: site.name,
        place: area.name.toLowerCase(),
        catalogued: true,
        description,
        seed: "house",
        items,
        lastSeen: now,
        lastObserver: "01",
      }, { watch: false });
    }
    await attachSite(area.id, existing.get(site.name)?.key ?? key);
    sites++;
  }
}

const events = HOUSE_EVENTS;
let added = 0;
for (const e of events) {
  const [{ n }] = await cypher<{ n: unknown }>(`MATCH (e:Event {summary: $summary}) RETURN count(e) AS n`, { summary: e.summary });
  if (Number(n) > 0) continue; // already seeded: reruns do not pile up duplicates
  await insertEvent({
    type: "transition",
    observerId: e.observer,
    title: "Taken",
    location: [e.area, e.site],
    metadata: { object: e.object, from: e.site, detail: e.detail },
    summary: e.summary,
    ts: ago(e.minutes),
  });
  added++;
}
console.log(`seeded the house: ${HOUSE.people.length} roommates, ${HOUSE.areas.length} areas, ${sites} sites, ${added} new events`);
process.exit(0);
