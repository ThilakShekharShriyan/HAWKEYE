import type { Delta } from "@/lib/fast-commit";
import { formatClock, insertEvent } from "@/lib/events-repo";
import { cypher } from "@/lib/graph";
import { formatItems, normName, reconcile, withCounts, type Item } from "@/lib/inventory";
import { log } from "@/lib/log";
import { acquireWriteLock, describe, type ContainerDoc } from "@/lib/perception";
import type { ObserverId } from "@/lib/types";
import { listPlaceDocs, patchPlace } from "@/lib/world-store";

// Writes a change the live tracker proved (see lib/fast-commit.ts) to the saved
// place in FalkorDB: the place document and its HOLDS {count} links, plus a
// "Taken" or "Added" event per item. It takes the same write lock as perception
// episodes, so the two cannot both record the same bottle leaving; the slower
// model episode that follows reconciles against these fresh counts.

const singular = (word: string) => (word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.replace(/s$/, ""));
/** The noun an item is named by: "water bottle" and "bottle" are both a bottle. */
const headNoun = (name: string) => singular(normName(name).split(" ").filter(Boolean).pop() ?? "");

/**
 * The stored item a detector label refers to, only when exactly one item has
 * the same head noun ("bottle" matches "water bottle"). Two bottles, or no
 * bottle, is ambiguous: the fast path leaves that to the model episode.
 */
export function itemForLabel(items: Pick<Item, "name" | "count">[], label: string) {
  const head = headNoun(label);
  if (!head) return null;
  const matches = items.filter((item) => headNoun(item.name) === head);
  return matches.length === 1 ? matches[0] : null;
}

export type FastResult =
  | { applied: true; item: string; from: number; to: number }
  | { applied: false; reason: string };

/** The saved place a dashboard says is in view: the exact place, or "table" for the only "table N". */
async function findSite(place: string) {
  const wanted = normName(place);
  const sites = await listPlaceDocs();
  const exact = sites.find((site) => site.key === `container:${wanted}`) ?? sites.find((site) => normName(site.name) === wanted);
  if (exact) return exact;
  const prefixed = sites.filter((site) => normName(site.name).startsWith(`${wanted} `));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/** An item that was taken from this place down to zero no longer sits in its contents, so look it up in what was taken. */
async function takenFromHere(site: ContainerDoc, label: string) {
  const rows = await cypher<{ object: unknown }>(
    `MATCH (e:Event {type: 'transition', title: 'Taken'})
     WHERE e.metaFrom = $name AND e.metaObject IS NOT NULL
     RETURN DISTINCT e.metaObject AS object ORDER BY e.ts DESC LIMIT 20`,
    { name: site.name },
  );
  const names = rows.map((row) => String(row.object)).filter(Boolean);
  const head = headNoun(label);
  const matches = [...new Set(names.filter((name) => headNoun(name) === head))];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Applies every change one reach proved, under one lock and one place write.
 * `startedAt` is on the server's clock (the route stamps it), the same clock as
 * an episode's `lastChange.at`.
 */
export async function applyTrackerDeltas({
  observerId,
  place,
  deltas,
}: {
  observerId: ObserverId;
  place: string;
  deltas: Delta[];
}): Promise<FastResult[]> {
  if (deltas.length === 0) return [];
  const t0 = performance.now();
  const release = await acquireWriteLock();
  const lockMs = Math.round(performance.now() - t0);
  try {
    const site = await findSite(place);
    const readMs = Math.round(performance.now() - t0) - lockMs;
    if (!site) return deltas.map(() => ({ applied: false, reason: `no unique saved place named ${normName(place)}` }));

    const now = new Date();
    const time = formatClock(now);
    let working = withCounts(site.items);
    const results: FastResult[] = [];
    const events: Parameters<typeof insertEvent>[0][] = [];
    const notes: string[] = [];
    const touched: string[] = [];

    for (const delta of deltas) {
      let item = itemForLabel(working, delta.label);
      let from = item?.count ?? 0;
      let name = item?.name;
      if (!item && delta.after > delta.before) {
        // A put-back of the last one: the item left the contents when it reached zero.
        name = (await takenFromHere(site, delta.label)) ?? undefined;
        from = 0;
      }
      if (!name) {
        results.push({ applied: false, reason: `${site.name} holds nothing like a ${delta.label}` });
        continue;
      }
      // An episode already recorded a change to this very item since the hand came in.
      const last = site.lastChange;
      if (last?.source === "episode" && new Date(last.at).getTime() >= delta.startedAt && last.items?.includes(name)) {
        results.push({ applied: false, reason: "already recorded by an episode" });
        continue;
      }
      const to = Math.max(0, from + (delta.after - delta.before));
      if (to === from) {
        results.push({ applied: false, reason: "count already matches" });
        continue;
      }

      const target = working.filter((i) => i.name !== name).map((i) => ({ name: i.name, count: i.count }));
      if (to > 0) target.push({ name, count: to });
      working = reconcile(working, target, observerId, now).items;

      const amount = Math.abs(to - from);
      const taken = to < from;
      const things = `${amount} ${name}`;
      const left = to > 0 ? `${to} left` : "none left";
      events.push({
        type: "transition",
        observerId,
        title: taken ? "Taken" : "Added",
        location: site.place ? [site.place, site.name] : [site.name],
        metadata: taken
          ? { object: name, from: site.name, to: `Seen by observer ${observerId}`, detail: `${from} → ${to}` }
          : { object: name, from: `Observer ${observerId}`, to: site.name, detail: `${from} → ${to}` },
        summary: taken
          ? `${things} was taken from the ${site.name} at ${time}, seen happening by observer ${observerId}'s camera; ${left}.`
          : `${things} was added to the ${site.name}; seen by observer ${observerId} at ${time}; now ${to}.`,
      });
      notes.push(`${taken ? "-" : "+"}${amount} ${name} (${from}→${to})`);
      touched.push(name);
      results.push({ applied: true, item: name, from, to });
    }

    if (events.length === 0) return results;

    // observedAt moves forward so an episode whose model call began before this
    // write cannot put its older reading over the new count.
    const before = {
      items: site.items,
      lastSeen: site.lastSeen,
      lastObserver: site.lastObserver,
      lastChange: site.lastChange,
      description: site.description,
      observedAt: site.observedAt,
    };
    await patchPlace(site.key, {
      items: working,
      lastSeen: now,
      lastObserver: observerId,
      lastChange: { summary: notes.join(", "), by: observerId, at: now, items: touched, source: "tracker" },
      description: describe({ ...site, items: working }),
      observedAt: now,
    });
    const updateMs = Math.round(performance.now() - t0) - lockMs - readMs;
    try {
      for (const event of events) await insertEvent(event);
    } catch (error) {
      // Counts without their events would be untraceable: put the place back as it was.
      await patchPlace(site.key, before).catch(() => {});
      throw error;
    }
    log("fast", "committed from the tracker", {
      lockMs,
      readMs,
      updateMs,
      totalMs: Math.round(performance.now() - t0),
      observer: observerId,
      place: site.name,
      changes: notes,
      contents: formatItems(working),
    });
    return results;
  } finally {
    release();
  }
}

/** One change: see applyTrackerDeltas. */
export async function applyTrackerDelta(args: { observerId: ObserverId; place: string; delta: Delta }): Promise<FastResult> {
  const [result] = await applyTrackerDeltas({ observerId: args.observerId, place: args.place, deltas: [args.delta] });
  return result;
}
