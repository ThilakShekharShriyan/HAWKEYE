import type { Delta } from "@/lib/fast-commit";
import { formatClock, insertEvent } from "@/lib/events-repo";
import { formatItems, normName, reconcile, withCounts, type Item } from "@/lib/inventory";
import { log } from "@/lib/log";
import { acquireWriteLock, describe } from "@/lib/perception";
import type { ObserverId } from "@/lib/types";
import { listPlaceDocs, patchPlace } from "@/lib/world-store";

// Writes a change the live tracker proved (see lib/fast-commit.ts) to the saved
// place in FalkorDB: the place document and its HOLDS {count} links, plus a
// "Taken" or "Added" event. It takes the same write lock as perception
// episodes, so the two cannot both record the same bottle leaving; the slower
// model episode that follows reconciles against these fresh counts.

/** The stored item a detector label refers to: "bottle" matches "water bottle". */
export function itemForLabel(items: Pick<Item, "name" | "count">[], label: string) {
  const words = new Set(normName(label).split(" ").filter(Boolean));
  const matches = items.filter((item) =>
    normName(item.name)
      .split(" ")
      .some((word) => words.has(word) || words.has(word.replace(/s$/, ""))),
  );
  return matches.sort((a, b) => b.count - a.count)[0] ?? null;
}

export type FastResult =
  | { applied: true; item: string; from: number; to: number }
  | { applied: false; reason: string };

/** The saved place a dashboard says is in view: "table" also matches "table 2" when it is the only one. */
async function findSite(place: string) {
  const wanted = normName(place);
  const sites = await listPlaceDocs();
  return (
    sites.find((site) => site.key === `container:${wanted}`) ??
    sites.find((site) => normName(site.name) === wanted) ??
    sites.find((site) => normName(site.name).startsWith(`${wanted} `)) ??
    null
  );
}

export async function applyTrackerDelta({
  observerId,
  place,
  delta,
}: {
  observerId: ObserverId;
  place: string;
  delta: Delta;
}): Promise<FastResult> {
  const t0 = performance.now();
  const release = await acquireWriteLock();
  const lockMs = Math.round(performance.now() - t0);
  try {
    const site = await findSite(place);
    const readMs = Math.round(performance.now() - t0) - lockMs;
    if (!site) return { applied: false, reason: `no saved place named ${normName(place)}` };

    // Something (a perception episode) already recorded a change since the hand came in.
    if (site.lastChange && new Date(site.lastChange.at).getTime() >= delta.startedAt) {
      return { applied: false, reason: "already recorded by an episode" };
    }

    const items = withCounts(site.items);
    const item = itemForLabel(items, delta.label);
    if (!item) return { applied: false, reason: `${site.name} holds nothing like a ${delta.label}` };

    const to = Math.max(0, item.count + (delta.after - delta.before));
    if (to === item.count) return { applied: false, reason: "count already matches" };

    const now = new Date();
    const target = items.map((i) => ({ name: i.name, count: i.name === item.name ? to : i.count })).filter((i) => i.count > 0);
    const next = reconcile(items, target, observerId, now);
    const time = formatClock(now);
    const amount = Math.abs(to - item.count);
    const taken = to < item.count;
    const things = `${amount} ${item.name}`;
    const left = to > 0 ? `${to} left` : "none left";
    const summary = taken
      ? `${things} was taken from the ${site.name} at ${time}, seen happening by observer ${observerId}'s camera; ${left}.`
      : `${things} was added to the ${site.name}; seen by observer ${observerId} at ${time}; now ${to}.`;

    // patchPlace rewrites the place document and every HOLDS {count} link.
    await patchPlace(site.key, {
      items: next.items,
      lastSeen: now,
      lastObserver: observerId,
      lastChange: { summary: `${taken ? "-" : "+"}${amount} ${item.name} (${item.count}→${to})`, by: observerId, at: now },
      description: describe({ ...site, items: next.items }),
    });
    const updateMs = Math.round(performance.now() - t0) - lockMs - readMs;
    await insertEvent({
      type: "transition",
      observerId,
      title: taken ? "Taken" : "Added",
      location: site.place ? [site.place, site.name] : [site.name],
      metadata: taken
        ? { object: item.name, from: site.name, to: `Seen by observer ${observerId}`, detail: `${item.count} → ${to}` }
        : { object: item.name, from: `Observer ${observerId}`, to: site.name, detail: `${item.count} → ${to}` },
      summary,
    });
    log("fast", "committed from the tracker", {
      lockMs,
      readMs,
      updateMs,
      totalMs: Math.round(performance.now() - t0),
      observer: observerId,
      place: site.name,
      item: item.name,
      from: item.count,
      to,
      contents: formatItems(next.items),
    });
    return { applied: true, item: item.name, from: item.count, to };
  } finally {
    release();
  }
}
