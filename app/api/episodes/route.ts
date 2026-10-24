import { holdsLease } from "@/lib/capture-lease";
import { hasModel, MISSING_KEY_MESSAGE } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { perceiveEpisode, type EpisodeFrame, type EpisodeStats } from "@/lib/perception";
import { isObserverId } from "@/lib/signal-store";

const MAX_FRAMES = 6;
/** Decoded bytes allowed per frame, and per request in total. */
const MAX_FRAME_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 6_000_000;
/** Capture times are client clocks; accept a window around the server's. */
const MAX_PAST_MS = 10 * 60_000;
const MAX_FUTURE_MS = 60_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PHASES = new Set(["pre", "during", "after"]);
const AUTO_REGISTER = /^(1|true|on)$/i.test(process.env.AUTO_REGISTER ?? "");

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_TOTAL_BYTES * 2) {
    return Response.json({ error: "request too large" }, { status: 413 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    observerId?: string;
    viewer?: string;
    trigger?: string;
    anchor?: { key?: string; name?: string; container?: string };
    /** Kind of site the on-device detector saw ("fridge", "table") when no anchor matched. */
    site?: string;
    /** Sent by motion alone, with no detector or anchor match: only update a place that is already registered. */
    knownOnly?: boolean;
    /** Started by movement alone: nothing on the dashboard recognised the place. */
    passive?: boolean;
    frames?: EpisodeFrame[];
    stats?: EpisodeStats;
  };
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (typeof body.viewer !== "string" || !holdsLease(body.viewer)) {
    log("episode", "rejected: not the capture leader", { observer: body.observerId, viewer: body.viewer });
    return Response.json({ error: "not the capture leader" }, { status: 409 });
  }
  const rawFrames = Array.isArray(body.frames) ? body.frames : [];
  const candidates = rawFrames
    .filter((frame) => frame && typeof frame.image === "string" && frame.image.length > 0)
    .slice(-MAX_FRAMES)
    .map((frame) => ({ ...frame, image: frame.image.replace(/^data:image\/\w+;base64,/, "") }));
  if (candidates.length === 0) return Response.json({ error: "frames required" }, { status: 400 });
  const now = Date.now();
  let total = 0;
  for (const [index, frame] of candidates.entries()) {
    const bytes = Math.floor((frame.image.length * 3) / 4);
    total += bytes;
    if (bytes > MAX_FRAME_BYTES || total > MAX_TOTAL_BYTES) {
      return Response.json({ error: "frames too large" }, { status: 413 });
    }
    if (!BASE64.test(frame.image)) {
      return Response.json({ error: "frame is not base64 image data" }, { status: 400 });
    }
    if (
      typeof frame.at !== "number" ||
      !Number.isFinite(frame.at) ||
      frame.at < now - MAX_PAST_MS ||
      frame.at > now + MAX_FUTURE_MS ||
      (index > 0 && frame.at < candidates[index - 1].at) ||
      !PHASES.has(frame.phase)
    ) {
      return Response.json({ error: "invalid frame time or phase" }, { status: 400 });
    }
  }
  const frames = candidates;
  if (!hasModel()) return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
  const container = (body.anchor?.container ?? body.anchor?.name ?? body.site ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .slice(0, 40);

  const started = performance.now();
  log("episode", "received", {
    observer: body.observerId,
    trigger: body.trigger,
    frames: frames.length,
    site: body.site,
    knownOnly: body.knownOnly === true,
    anchor: body.anchor?.name,
    stats: body.stats,
  });
  try {
    const result = await perceiveEpisode({
      observerId: body.observerId,
      trigger: body.trigger ?? "refrigerator",
      frames,
      stats: body.stats,
      container: container || (body.knownOnly ? "place" : undefined),
      anchorKey: typeof body.anchor?.key === "string" ? body.anchor.key.slice(0, 80) : undefined,
      anchorName: typeof body.anchor?.name === "string" ? body.anchor.name.slice(0, 40) : undefined,
      // Places are created only when someone says "remember this". The
      // detector sees a table in almost every room; letting it register one
      // filled the memory with tables nobody asked for and their clutter.
      // AUTO_REGISTER=1 restores registering whatever the detector finds.
      knownOnly: body.knownOnly === true || !AUTO_REGISTER,
      passive: body.passive === true && !body.anchor,
      // The lease can lapse during a slow model call; re-checked at commit.
      commitGuard: () => holdsLease(body.viewer as string),
    });
    log("episode", "done", {
      observer: body.observerId,
      site: result.container,
      identity: result.identity,
      skipped: result.skipped,
      coverage: result.coverage,
      contentsVisible: result.contentsVisible,
      changes: result.changes,
      inventory: result.inventory,
      cached: result.cached,
      tokens: result.tokens,
      ms: Math.round(performance.now() - started),
    });
    return Response.json(result);
  } catch (cause) {
    log("episode", "failed", { observer: body.observerId, error: errorText(cause), ms: Math.round(performance.now() - started) });
    return Response.json(
      { error: cause instanceof Error ? cause.message : "perception failed" },
      { status: 502 },
    );
  }
}
