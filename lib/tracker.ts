import { log } from "@/lib/log";

// Client for the tracker sidecar (tracker/server.py, roboflow/trackers). It
// follows people and portable things across an episode's keyframes. The result
// is evidence for the perception model, never a verdict, and every failure is
// swallowed: with no sidecar the app behaves exactly as before.

export type Track = {
  id: number;
  label: string;
  /** Zero-based indexes of the keyframes the track was seen in. */
  frames: number[];
  firstBox: [number, number, number, number];
  lastBox: [number, number, number, number];
  maxConfidence: number;
};

const TIMEOUT_MS = 3000;
const LIVE_TIMEOUT_MS = 1500;

/** One object in the live view: where it is now and where it has been. */
export type LiveObject = {
  id: number;
  label: string;
  confidence: number;
  /** x1, y1, x2, y2 as fractions of the frame. */
  box: [number, number, number, number];
  /** Recent box centres, oldest first, as fractions of the frame. */
  trail: [number, number][];
};

export type LiveFrame = { seq: number; at: number; ms: number; objects: LiveObject[] };

export const trackerUrl = () => process.env.TRACKER_URL?.replace(/\/$/, "") || null;

/** Live tracking is opt-in (TRACKER_LIVE=1) on top of having a sidecar. */
export const liveEnabled = () => trackerUrl() !== null && /^(1|true|on)$/i.test(process.env.TRACKER_LIVE ?? "");

export async function trackerStatus() {
  const url = trackerUrl();
  if (!url) return { configured: false as const };
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    const body = (await response.json()) as { loaded?: boolean; detector?: string; tracker?: string };
    return { configured: true as const, ok: response.ok, live: liveEnabled(), ...body };
  } catch (cause) {
    return { configured: true as const, ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Tracks for these frames (any order), or null when the sidecar is off, slow or failing. */
export async function trackEpisode(frames: { image: string; at: number }[]): Promise<Track[] | null> {
  const url = trackerUrl();
  if (!url || frames.length < 2) return null;
  try {
    const response = await fetch(`${url}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames: frames.map(({ image, at }) => ({ image, at })) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`tracker ${response.status}`);
    const body = (await response.json()) as { tracks?: Track[] };
    return Array.isArray(body.tracks) ? body.tracks : null;
  } catch (cause) {
    log("tracker", "unavailable, continuing without tracks", { error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/** One live frame through the observer's persistent tracker; null when the sidecar is off, slow or failing. */
export async function trackLive(
  observer: string,
  jpeg: Uint8Array<ArrayBuffer>,
  at: number,
): Promise<LiveFrame | null> {
  const url = trackerUrl();
  if (!url) return null;
  try {
    const response = await fetch(`${url}/live/${encodeURIComponent(observer)}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Frame-At": String(at) },
      body: jpeg,
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`tracker ${response.status}`);
    const body = (await response.json()) as LiveFrame;
    return Array.isArray(body.objects) ? body : null;
  } catch (cause) {
    log("tracker", "live frame failed", { observer, error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/**
 * What the live tracker saw around each of these times (the keyframes of an
 * episode, indexed in the order given). Null when there is no live history for
 * them, so the caller can fall back to tracking the keyframes themselves.
 */
export async function liveTracks(observer: string, times: number[]): Promise<Track[] | null> {
  const url = trackerUrl();
  if (!url || !liveEnabled() || times.length === 0) return null;
  try {
    const response = await fetch(`${url}/live/${encodeURIComponent(observer)}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ times }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`tracker ${response.status}`);
    const body = (await response.json()) as { tracks?: Track[]; matched?: number };
    return Array.isArray(body.tracks) && (body.matched ?? 0) > 0 ? body.tracks : null;
  } catch (cause) {
    log("tracker", "live history unavailable", { observer, error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

/**
 * Re-indexes tracks computed over all of an episode's frames onto the subset
 * the model is shown (`keep` lists the original indexes, in order). Tracks
 * with no kept frame are dropped.
 */
export function remapTracks(tracks: Track[] | null, keep: number[]): Track[] | null {
  if (!tracks) return null;
  const position = new Map(keep.map((original, index) => [original, index]));
  return tracks.flatMap((track) => {
    const frames = track.frames.flatMap((frame) => (position.has(frame) ? [position.get(frame)!] : []));
    return frames.length > 0 ? [{ ...track, frames }] : [];
  });
}

const range = (frames: number[]) =>
  frames.length === 1 ? `frame ${frames[0] + 1}` : `frames ${frames[0] + 1}-${frames[frames.length - 1] + 1}`;

/** Where in the frame a box sits, in words a model can use. */
function region([x1, y1, x2, y2]: Track["firstBox"]) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const horizontal = cx < 0.33 ? "left" : cx > 0.67 ? "right" : "centre";
  const vertical = cy < 0.33 ? "top" : cy > 0.67 ? "bottom" : "middle";
  return `${vertical} ${horizontal}`;
}

/**
 * One line per track: what was seen, in which frames, and whether it entered
 * or left view during the episode. Order and wording are deterministic so the
 * perception cache can key on frames alone.
 */
export function summarizeTracks(tracks: Track[], frameCount: number): string[] {
  const lines: string[] = [];
  for (const track of tracks) {
    const frames = [...new Set(track.frames)].sort((a, b) => a - b);
    if (frames.length === 0) continue;
    const first = frames[0];
    const last = frames[frames.length - 1];
    const parts = [`${track.label} #${track.id}: ${range(frames)} of ${frameCount}`];
    if (first > 0) parts.push(`entered view after frame ${first}, near ${region(track.firstBox)}`);
    if (last < frameCount - 1) parts.push(`not seen after frame ${last + 1}, last near ${region(track.lastBox)}`);
    if (first === 0 && last === frameCount - 1) parts.push("in view throughout");
    lines.push(parts.join("; "));
  }
  return lines;
}

/** The text block added to the perception prompt, or null when there is nothing to say. */
export function trackEvidence(tracks: Track[] | null, frameCount: number) {
  if (!tracks) return null;
  const lines = summarizeTracks(tracks, frameCount);
  const people = tracks.filter((track) => track.label === "person").length;
  const header = `TRACKER EVIDENCE (object tracker over the ${frameCount} frames; it recognises people and portable things such as laptops, bottles, cups and bags, but not snacks or specific cans, so a thing missing here proves nothing):`;
  if (lines.length === 0) return `${header}\n- nothing tracked.`;
  return `${header}\n${lines.map((line) => `- ${line}`).join("\n")}\n- people tracked: ${people}.`;
}
