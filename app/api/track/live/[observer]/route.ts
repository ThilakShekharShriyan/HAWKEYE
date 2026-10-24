import { MAX_FRAME_BYTES } from "@/lib/frame-relay";
import { isObserverId } from "@/lib/signal-store";
import { appendFile, mkdir } from "node:fs/promises";
import { FastCommit } from "@/lib/fast-commit";
import { applyTrackerDelta } from "@/lib/fast-commit-repo";
import { liveEnabled, trackLive } from "@/lib/tracker";

// One state machine per observer: a hand reaching in, a bottle gone, committed
// to the saved place the dashboard says is in view (?place=). A long silence
// means a new scene, so the machine starts over.
const machines = globalThis as typeof globalThis & { __worldstateFastCommit?: Map<string, { machine: FastCommit; lastAt: number }> };
const states: Map<string, { machine: FastCommit; lastAt: number }> = (machines.__worldstateFastCommit ??= new Map());
const GAP_MS = 5000;
// TRACKER_RECORD=1 keeps every live frame's boxes in logs/live-tracks.jsonl, so a real
// handheld session can be replayed offline to tune the fast path (logs/ is git-ignored).
const RECORD = /^(1|true|on)$/i.test(process.env.TRACKER_RECORD ?? "");

// The latest result per observer, so dashboard tabs that do not hold the capture
// lease (and so do not send frames) can still draw the same boxes.
const latest = globalThis as typeof globalThis & { __worldstateLiveLatest?: Map<string, { frame: unknown; receivedAt: number }> };
const lastResult: Map<string, { frame: unknown; receivedAt: number }> = (latest.__worldstateLiveLatest ??= new Map());

// The dashboard posts one small JPEG per call (a few a second) and gets back
// the boxes, labels, IDs and trails to draw. One tracker per observer lives in
// the sidecar, so IDs hold from one call to the next.

export async function POST(request: Request, ctx: RouteContext<"/api/track/live/[observer]">) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) return Response.json({ error: "unknown observer" }, { status: 404 });
  if (!liveEnabled()) return Response.json({ enabled: false });
  const jpeg = new Uint8Array(await request.arrayBuffer());
  if (jpeg.length < 100 || jpeg.length > MAX_FRAME_BYTES) {
    return Response.json({ error: "bad frame" }, { status: 400 });
  }
  const at = Number(request.headers.get("X-Frame-At")) || Date.now();
  const frame = await trackLive(observer, jpeg, at);
  if (!frame) return Response.json({ enabled: true, error: "tracker unavailable" }, { status: 503 });
  let state = states.get(observer);
  if (!state || Math.abs(at - state.lastAt) > GAP_MS) states.set(observer, (state = { machine: new FastCommit(), lastAt: at }));
  state.lastAt = at;
  const deltas = state.machine.push({ at, objects: frame.objects.map(({ label, box }) => ({ label, box })) });
  const place = new URL(request.url).searchParams.get("place")?.trim().slice(0, 60);
  const committed = place
    ? await Promise.all(deltas.map((delta) => applyTrackerDelta({ observerId: observer, place, delta }).catch(() => null)))
    : [];
  lastResult.set(observer, { frame, receivedAt: Date.now() });
  if (RECORD) {
    const line = JSON.stringify({ observer, at, place: place ?? null, objects: frame.objects.map(({ id, label, box, confidence }) => ({ id, label, box, confidence })) });
    mkdir("logs", { recursive: true }).then(() => appendFile("logs/live-tracks.jsonl", `${line}\n`)).catch(() => {});
  }
  return Response.json({ enabled: true, ...frame, committed: committed.filter(Boolean) }, { headers: { "Cache-Control": "no-store" } });
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
