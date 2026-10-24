import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveFrame } from "../lib/tracker";

type Obj = { id: number; label: string; confidence: number; box: [number, number, number, number]; trail: [number, number][] };
const queue: Obj[][] = [];

const trackLive = vi.fn(async (..._args: unknown[]): Promise<LiveFrame> => ({ seq: 1, at: 0, ms: 1, objects: queue.shift() ?? [] }));
vi.mock("../lib/tracker", () => ({ liveEnabled: () => true, trackLive: (...args: unknown[]) => trackLive(...args) }));
const privacy = { on: false };
vi.mock("../lib/world-store", () => ({ privacyActive: async () => privacy.on }));
const apply = vi.fn(async (args: { deltas: unknown[] }) => args.deltas.map(() => ({ applied: true as const, item: "water bottle", from: 2, to: 1 })));
vi.mock("../lib/fast-commit-repo", () => ({ applyTrackerDeltas: (args: { deltas: unknown[] }) => apply(args) }));

const { POST } = await import("../app/api/track/live/[observer]/route");
const { claimLease } = await import("../lib/capture-lease");

const bottle = (x: number): Obj => ({ id: x * 10, label: "bottle", confidence: 0.9, box: [x, 0.5, x + 0.08, 0.7], trail: [] });
const hand: Obj = { id: 1, label: "person", confidence: 0.9, box: [0.42, 0.45, 0.57, 0.95], trail: [] };
const two = [bottle(0.4), bottle(0.5)];
const one = [bottle(0.4)];
// 7 calm frames, a reach that touches the bottles, then 2 settled frames with one bottle gone.
const reach = (): Obj[][] => [...Array(7).fill(two), ...Array(3).fill([...two, hand]), ...Array(2).fill(one)];

async function send(query: string, observer = "01") {
  const request = new Request(`http://x/api/track/live/${observer}${query}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "X-Frame-At": String(Date.now()) },
    body: new Uint8Array(300),
  });
  const response = await POST(request, { params: Promise.resolve({ observer }) } as never);
  return { status: response.status, body: (await response.json()) as { committed?: unknown[]; objects?: unknown[]; error?: string } };
}
async function play(frames: Obj[][], query: string | ((i: number) => string), observer = "01") {
  let last = { status: 0, body: {} as Awaited<ReturnType<typeof send>>["body"] };
  const committed: unknown[] = [];
  for (const [i, frame] of frames.entries()) {
    queue.push(frame);
    last = await send(typeof query === "function" ? query(i) : query, observer);
    committed.push(...(last.body.committed ?? []));
  }
  return { last, committed };
}

beforeEach(() => {
  apply.mockClear();
  trackLive.mockClear();
  privacy.on = false;
  queue.length = 0;
  (globalThis as { __worldstateFastCommit?: Map<string, unknown> }).__worldstateFastCommit?.clear();
});

describe("POST /api/track/live/[observer]", () => {
  it("rejects a viewer that does not hold the capture lease", async () => {
    claimLease("the-leader");
    const { status, body } = await send("?place=table&viewer=intruder");
    expect(status).toBe(409);
    expect(body.error).toBe("not the capture leader");
    expect(apply).not.toHaveBeenCalled();
  });

  it("commits a proven change for the lease holder, with server-time startedAt", async () => {
    claimLease("the-leader");
    const before = Date.now();
    const { committed } = await play(reach(), "?place=table&viewer=the-leader");
    expect(apply).toHaveBeenCalledTimes(1);
    const call = apply.mock.calls[0][0] as unknown as { place: string; observerId: string; deltas: { label: string; before: number; after: number; startedAt: number }[] };
    expect(call.place).toBe("table");
    expect(call.deltas).toEqual([expect.objectContaining({ label: "bottle", before: 2, after: 1 })]);
    expect(call.deltas[0].startedAt).toBeGreaterThanOrEqual(before);
    expect(committed).toHaveLength(1);
  });

  it("draws boxes but never writes a count when there is no viewer (demo playback)", async () => {
    const { last } = await play(reach(), "?place=table");
    expect(last.status).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });

  it("drops an interaction when the place in view changes mid-reach", async () => {
    claimLease("the-leader");
    // Baseline and hand at the table, but the hand leaves while a different place is recognised.
    const frames = reach();
    await play(frames, (i) => (i < 10 ? "?place=table&viewer=the-leader" : "?place=shelf&viewer=the-leader"));
    expect(apply).not.toHaveBeenCalled();
  });

  it("reports a failed commit instead of hiding it", async () => {
    claimLease("the-leader");
    apply.mockRejectedValueOnce(new Error("graph down"));
    const { committed } = await play(reach(), "?place=table&viewer=the-leader");
    expect(committed).toEqual([{ applied: false, reason: "error" }]);
  });

  it("stops tracking and recording while privacy mode is on, and starts fresh afterwards", async () => {
    claimLease("the-leader");
    privacy.on = true;
    const { last } = await play(reach(), "?place=table&viewer=the-leader");
    expect((last.body as { privacy?: boolean }).privacy).toBe(true);
    expect(trackLive).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    // After the window the interaction state is gone: half a reach played before is not carried over.
    privacy.on = false;
    await play(reach(), "?place=table&viewer=the-leader");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("keeps demo playback on its own sidecar session and out of the live fast-path state", async () => {
    claimLease("the-leader");
    await play(reach(), "?place=table");
    expect(trackLive.mock.calls.every((call) => call[0] === "01:demo")).toBe(true);
    const store = (globalThis as { __worldstateFastCommit?: Map<string, unknown> }).__worldstateFastCommit;
    expect(store?.has("01") ?? false).toBe(false);
    // A leader's reach is unaffected by demo frames interleaved with it.
    const frames = reach();
    for (const frame of frames) {
      queue.push(frame);
      await send("?place=table&viewer=the-leader");
      queue.push([]);
      await send("?place=table"); // demo frame in between
    }
    expect(trackLive.mock.calls.some((call) => call[0] === "01")).toBe(true);
  });

  it("refuses a body over the frame limit, declared or streamed, before processing it", async () => {
    claimLease("the-leader");
    const big = new Uint8Array(500_000);
    const declared = await POST(
      new Request("http://x/api/track/live/01?viewer=the-leader", { method: "POST", headers: { "content-length": String(big.length) }, body: big }),
      { params: Promise.resolve({ observer: "01" }) } as never,
    );
    expect(declared.status).toBe(413);
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(100_000));
        controller.close();
      },
    });
    const streamed = await POST(
      new Request("http://x/api/track/live/01?viewer=the-leader", { method: "POST", body: chunked, duplex: "half" } as RequestInit),
      { params: Promise.resolve({ observer: "01" }) } as never,
    );
    expect(streamed.status).toBe(413);
    expect(trackLive).not.toHaveBeenCalled();
  });

  it("retries a failed commit with the next frame instead of losing the reach", async () => {
    claimLease("the-leader");
    apply.mockRejectedValueOnce(new Error("graph down"));
    await play(reach(), "?place=table&viewer=the-leader");
    expect(apply).toHaveBeenCalledTimes(1);
    queue.push(one);
    const retry = await send("?place=table&viewer=the-leader");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(retry.body.committed).toHaveLength(1);
    const second = apply.mock.calls[1][0] as unknown as { deltas: { label: string; before: number; after: number }[] };
    expect(second.deltas).toEqual([expect.objectContaining({ label: "bottle", before: 2, after: 1 })]);
    // Once it succeeded nothing is retried again.
    queue.push(one);
    await send("?place=table&viewer=the-leader");
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("passes a guard that re-checks the capture lease at commit time", async () => {
    claimLease("the-leader");
    await play(reach(), "?place=table&viewer=the-leader");
    const { guard } = apply.mock.calls[0][0] as unknown as { guard: () => boolean };
    expect(typeof guard).toBe("function");
    expect(guard()).toBe(true);
  });
});
