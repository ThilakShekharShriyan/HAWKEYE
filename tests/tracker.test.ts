import { afterEach, describe, expect, it, vi } from "vitest";
import { liveEnabled, liveTracks, summarizeTracks, trackEpisode, trackEvidence, trackLive, trackerStatus, type Track } from "../lib/tracker";

const box = (x1: number, y1: number, x2: number, y2: number): Track["firstBox"] => [x1, y1, x2, y2];
const track = (over: Partial<Track>): Track => ({
  id: 1,
  label: "person",
  frames: [0],
  firstBox: box(0.4, 0.4, 0.6, 0.6),
  lastBox: box(0.4, 0.4, 0.6, 0.6),
  maxConfidence: 0.9,
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("summarizeTracks", () => {
  it("says a track in every frame is in view throughout", () => {
    expect(summarizeTracks([track({ label: "laptop", frames: [0, 1, 2, 3] })], 4)).toEqual([
      "laptop #1: frames 1-4 of 4; in view throughout",
    ]);
  });

  it("says when something entered view, and where", () => {
    const [line] = summarizeTracks([track({ frames: [2, 3], firstBox: box(0.0, 0.5, 0.2, 0.9) })], 4);
    expect(line).toContain("person #1: frames 3-4 of 4");
    expect(line).toContain("entered view after frame 2, near bottom left");
  });

  it("says when something left view, and where it was last", () => {
    const [line] = summarizeTracks([track({ label: "laptop", frames: [0, 1], lastBox: box(0.7, 0.1, 0.95, 0.3) })], 5);
    expect(line).toContain("not seen after frame 2, last near top right");
  });

  it("de-duplicates and sorts frame indexes and skips empty tracks", () => {
    const lines = summarizeTracks([track({ frames: [3, 1, 1] }), track({ id: 2, frames: [] })], 4);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("frames 2-4 of 4");
  });
});

describe("trackEvidence", () => {
  it("is null without a tracker result, so the prompt is unchanged", () => {
    expect(trackEvidence(null, 6)).toBeNull();
  });

  it("states plainly when nothing was tracked, and what the tracker cannot see", () => {
    const text = trackEvidence([], 6)!;
    expect(text).toContain("nothing tracked");
    expect(text).toContain("not snacks or specific cans");
  });

  it("lists tracks and counts people", () => {
    const text = trackEvidence([track({ frames: [1, 2] }), track({ id: 2, label: "laptop", frames: [0, 1, 2] })], 3)!;
    expect(text).toContain("- person #1:");
    expect(text).toContain("- laptop #2:");
    expect(text).toContain("people tracked: 1.");
  });
});

describe("trackEpisode", () => {
  const frames = [
    { image: "a", at: 1 },
    { image: "b", at: 2 },
  ];

  it("does nothing without TRACKER_URL", async () => {
    vi.stubEnv("TRACKER_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await trackEpisode(frames)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs at least two frames to follow anything", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await trackEpisode(frames.slice(0, 1))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts frames and returns the tracks", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test/");
    const fetchSpy = vi.fn(async () => Response.json({ tracks: [track({})] }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await trackEpisode(frames)).toEqual([track({})]);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://tracker.test/track");
    expect(JSON.parse(init.body as string).frames).toHaveLength(2);
  });

  it("fails open: an error, a bad status or a bad body yields null, never a throw", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));
    expect(await trackEpisode(frames)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await trackEpisode(frames)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ nope: true })));
    expect(await trackEpisode(frames)).toBeNull();
  });
});

describe("trackerStatus", () => {
  it("reports not configured, healthy, and unreachable", async () => {
    vi.stubEnv("TRACKER_URL", "");
    expect(await trackerStatus()).toEqual({ configured: false });
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, loaded: true, detector: "rf-detr-small", tracker: "bytetrack" })));
    expect(await trackerStatus()).toMatchObject({ configured: true, ok: true, tracker: "bytetrack" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await trackerStatus()).toMatchObject({ configured: true, ok: false, error: "down" });
  });
});

describe("live tracking", () => {
  const jpeg = new Uint8Array(new ArrayBuffer(200));
  const frame = { seq: 3, at: 10, ms: 90, objects: [{ id: 1, label: "person", confidence: 0.9, box: [0.1, 0.1, 0.4, 0.9], trail: [[0.25, 0.5]] }] };

  it("needs both a sidecar and TRACKER_LIVE", () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    vi.stubEnv("TRACKER_LIVE", "");
    expect(liveEnabled()).toBe(false);
    vi.stubEnv("TRACKER_LIVE", "1");
    expect(liveEnabled()).toBe(true);
    vi.stubEnv("TRACKER_URL", "");
    expect(liveEnabled()).toBe(false);
  });

  it("posts the raw JPEG with its capture time and returns the frame", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    const fetchSpy = vi.fn(async () => Response.json(frame));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await trackLive("01", jpeg, 1234)).toEqual(frame);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://tracker.test/live/01");
    expect(init.headers).toMatchObject({ "Content-Type": "image/jpeg", "X-Frame-At": "1234" });
    expect(init.body).toBe(jpeg);
  });

  it("fails open on live frames", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    expect(await trackLive("01", jpeg, 1)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ nope: 1 })));
    expect(await trackLive("01", jpeg, 1)).toBeNull();
    vi.stubEnv("TRACKER_URL", "");
    expect(await trackLive("01", jpeg, 1)).toBeNull();
  });

  it("asks for live history by time and only trusts it when something matched", async () => {
    vi.stubEnv("TRACKER_URL", "http://tracker.test");
    vi.stubEnv("TRACKER_LIVE", "1");
    const fetchSpy = vi.fn(async () => Response.json({ tracks: [track({})], matched: 2 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await liveTracks("02", [100, 200])).toEqual([track({})]);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://tracker.test/live/02/tracks");
    expect(JSON.parse(init.body as string)).toEqual({ times: [100, 200] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ tracks: [], matched: 0 })));
    expect(await liveTracks("02", [100])).toBeNull();
    vi.stubEnv("TRACKER_LIVE", "");
    expect(await liveTracks("02", [100])).toBeNull();
  });
});
