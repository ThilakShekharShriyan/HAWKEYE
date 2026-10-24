import { MAX_FRAME_BYTES } from "@/lib/frame-relay";
import { isObserverId } from "@/lib/signal-store";
import { appendFile, mkdir } from "node:fs/promises";
import { FastCommit, type Delta } from "@/lib/fast-commit";
import { holdsLease } from "@/lib/capture-lease";
import { applyTrackerDeltas, type FastResult } from "@/lib/fast-commit-repo";
import { log } from "@/lib/log";
import { liveEnabled, trackLive } from "@/lib/tracker";
import { privacyActive } from "@/lib/world-store";

// One state machine per observer: a hand reaching in, a bottle gone, committed
// to the saved place the dashboard says is in view (?place=). A long silence
// means a new scene, so the machine starts over.
type Pending = { deltas: Delta[]; tries: number };
type State = { machine: FastCommit; lastAt: number; place: string | null; pending: Pending | null };
const machines = globalThis as typeof globalThis & { __worldstateFastCommit?: Map<string, State> };
const states: Map<string, State> = (machines.__worldstateFastCommit ??= new Map());
/** A commit that failed is retried on the next frames, this many times, then dropped. */
const MAX_COMMIT_TRIES = 3;
const GAP_MS = 5000;
// TRACKER_RECORD=1 keeps every live frame's boxes in logs/live-tracks.jsonl, so a real
// handheld session can be replayed offline to tune the fast path (logs/ is git-ignored).
const RECORD = /^(1|true|on)$/i.test(process.env.TRACKER_RECORD ?? "");

// The latest result per observer, so dashboard tabs that do not hold the capture
// lease (and so do not send frames) can still draw the same boxes.
const latest = globalThis as typeof globalThis & { __worldstateLiveLatest?: Map<string, { frame: unknown; receivedAt: number }> };
const lastResult: Map<string, { frame: unknown; receivedAt: number }> = (latest.__worldstateLiveLatest ??= new Map());

// Who may write: a request names the viewer tab sending it, and that tab must
// hold the capture lease, as for episodes. A request with no viewer (the demo,
// which plays a file and has no capture state) can draw boxes but never writes
// a count.

// The dashboard posts one small JPEG per call (a few a second) and gets back
// the boxes, labels, IDs and trails to draw. One tracker per observer lives in
// the sidecar, so IDs hold from one call to the next.

/** Reads the body up to the frame limit, stopping as soon as it is exceeded; null when it is too big. */
async function readFrame(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FRAME_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_FRAME_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const frame = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    frame.set(chunk, at);
    at += chunk.length;
  }
  return frame;
}

export async function POST(request: Request, ctx: RouteContext<"/api/track/live/[observer]">) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) return Response.json({ error: "unknown observer" }, { status: 404 });
  if (!liveEnabled()) return Response.json({ enabled: false });
  const query = new URL(request.url).searchParams;
  const viewer = query.get("viewer");
  if (viewer !== null && !holdsLease(viewer)) {
    return Response.json({ enabled: true, error: "not the capture leader" }, { status: 409 });
  }
  // Privacy mode means no processing and no recording of this camera. Tracking
  // starts again from a fresh scene once the window ends.
  if (await privacyActive(observer)) {
    states.delete(observer);
    lastResult.delete(observer);
    return Response.json({ enabled: true, privacy: true, objects: [], committed: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const jpeg = await readFrame(request);
  if (!jpeg || jpeg.length < 100) {
    return Response.json({ error: jpeg ? "bad frame" : "frame too large" }, { status: jpeg ? 400 : 413 });
  }
  const at = Number(request.headers.get("X-Frame-At")) || Date.now();
  // Demo playback (no viewer) has its own sidecar session, so it can never
  // scramble the IDs, the fast-path state or the results of a real capture.
  const frame = await trackLive(viewer === null ? `${observer}:demo` : observer, jpeg, at);
  if (!frame) return Response.json({ enabled: true, error: "tracker unavailable" }, { status: 503 });

  let committed: FastResult[] = [];
  const place = query.get("place")?.trim().slice(0, 60) || null;
  if (viewer !== null) {
    // The browser's clock and the server's can differ, and an episode stamps its
    // changes with the server's: the interaction is timed on the server's clock.
    const now = Date.now();
    let state = states.get(observer);
    // A long silence, or a different place coming into view, starts a new scene:
    // a reach that began at one place must never be written to another.
    if (!state || Math.abs(now - state.lastAt) > GAP_MS || state.place !== place) {
      states.set(observer, (state = { machine: new FastCommit(), lastAt: now, place, pending: null }));
    }
    state.lastAt = now;
    const proven = state.machine.push({ at: now, objects: frame.objects.map(({ label, box }) => ({ label, box })) });
    // Changes whose write failed earlier are tried again with this frame's.
    const deltas = [...(state.pending?.deltas ?? []), ...proven];
    if (deltas.length > 0 && place) {
      try {
        committed = await applyTrackerDeltas({ observerId: observer, place, deltas, guard: () => holdsLease(viewer) });
        state.pending = null;
      } catch (error) {
        const tries = (state.pending?.tries ?? 0) + 1;
        log("fast", "commit failed", { observer, place, labels: deltas.map((d) => d.label), tries, error: error instanceof Error ? error.message : String(error) });
        state.pending = tries < MAX_COMMIT_TRIES ? { deltas, tries } : null;
        committed = deltas.map(() => ({ applied: false as const, reason: "error" }));
      }
    }
    lastResult.set(observer, { frame, receivedAt: Date.now() });
  }
  if (RECORD) {
    const line = JSON.stringify({ observer, viewer: viewer !== null, at, place: place ?? null, objects: frame.objects.map(({ id, label, box, confidence }) => ({ id, label, box, confidence })) });
    mkdir("logs", { recursive: true }).then(() => appendFile("logs/live-tracks.jsonl", `${line}\n`)).catch(() => {});
  }
  return Response.json({ enabled: true, ...frame, committed }, { headers: { "Cache-Control": "no-store" } });
}

/** What the tab that holds the capture lease last got back, for tabs that only watch. */
export async function GET(_request: Request, ctx: RouteContext<"/api/track/live/[observer]">) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) return Response.json({ error: "unknown observer" }, { status: 404 });
  if (!liveEnabled()) return Response.json({ enabled: false });
  const entry = lastResult.get(observer);
  const ageMs = entry ? Date.now() - entry.receivedAt : null;
  return Response.json(
    { enabled: true, ageMs, ...(entry ? (entry.frame as object) : { objects: [] }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
