import { connection } from "next/server";
import { eventsAbout, formatClock } from "@/lib/events-repo";
import { log } from "@/lib/log";
import { readScene } from "@/lib/scene";
import { readWorldGraph } from "@/lib/world-graph";
import { listAnchorRecords, deletePlace, episodesFor, findPlaceByName, framesPresent, listPlaceDocs } from "@/lib/world-store";

const jpeg = (image: string) => (image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`);
const stamp = (date: Date) =>
  `${new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${formatClock(new Date(date))}`;

// Every tracked place with the pictures HAWKEYE holds for it: the
// reference photos used to tell it apart from other places, the saved visual
// anchor (embeddings of views, which start capture when matched) and the
// frames of its most recent episodes.
export async function GET() {
  await connection();
  try {
    const [sites, anchors] = await Promise.all([listPlaceDocs(), listAnchorRecords()]);

    const places = await Promise.all(
      sites.map(async (site) => {
        const episodes = await episodesFor(site.name, 12);
        const hashes = [...new Set(episodes.flatMap((episode) => episode.frameHashes ?? []))];
        const kept = await framesPresent(hashes);
        const siteEvents = await eventsAbout(site.name, 60);
        const anchor = anchors.find((candidate) => candidate.container === site.name || candidate.name === site.name);
        const scene = await readScene(site.key, site.name).catch(() => null);
        return {
          name: site.name,
          mark: site.mark ?? null,
          place: site.place ?? null,
          catalogued: site.catalogued !== false,
          items: (site.items ?? []).map((item) => ({
            name: item.name,
            count: item.count ?? 1,
          })),
          lastSeen: stamp(site.lastSeen),
          lastObserver: site.lastObserver,
          references: (site.references ?? []).map((reference) => ({
            image: jpeg(reference.image),
            at: stamp(reference.at),
            observerId: reference.observerId,
          })),
          anchor: anchor
            ? { name: anchor.name, views: anchor.references.length, updatedAt: stamp(new Date(anchor.updatedAt)) }
            : null,
          log: siteEvents.reverse().map((event) => ({
            id: event.id,
            ts: event.ts.getTime(),
            at: stamp(event.ts),
            type: event.type,
            kind:
              event.type === "transition"
                ? event.title === "Added"
                  ? "added"
                  : "removed"
                : event.type === "system"
                  ? "look"
                  : event.type,
            observerId: event.observerId ?? null,
            text: event.type === "system" ? event.title : event.summary,
          })),
          episodes: episodes.map((episode) => ({
            ts: episode.startedAt.getTime(),
            id: episode.id,
            at: stamp(episode.startedAt),
            observerId: episode.observerId,
            trigger: episode.trigger,
            changes: episode.changes ?? [],
            tokens: episode.tokens ?? 0,
            frames: [...new Set(episode.frameHashes ?? [])]
              .filter((hash) => kept.has(hash))
              .map((hash) => `/api/frames/${hash}`),
          })),
          scene,
        };
      }),
    );

    const used = new Set(places.map((place) => place.anchor?.name).filter(Boolean));
    const graph = await readWorldGraph().catch(() => ({ nodes: [], edges: [] }));
    return Response.json({
      graph,
      places,
      looseAnchors: anchors
        .filter((anchor) => !used.has(anchor.name))
        .map((anchor) => ({
          name: anchor.name,
          views: anchor.references.length,
          updatedAt: stamp(new Date(anchor.updatedAt)),
        })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}

// Removes a tracked place: its state, reference photos, visual anchor,
// episodes and the events recorded about it. Not reversible.
export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim().toLowerCase();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  try {
    const site = await findPlaceByName(name);
    if (!site) return Response.json({ error: "no such place" }, { status: 404 });
    const removed = await deletePlace(name);
    log("places", "place deleted", { name, ...removed });
    return Response.json({ ok: true, removed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
