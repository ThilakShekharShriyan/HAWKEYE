import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveFrame } from "../lib/tracker";

type Obj = { id: number; label: string; confidence: number; box: [number, number, number, number]; trail: [number, number][] };
const queue: Obj[][] = [];

vi.mock("../lib/tracker", () => ({
  liveEnabled: () => true,
  trackLive: vi.fn(async (): Promise<LiveFrame> => ({ seq: 1, at: 0, ms: 1, objects: queue.shift() ?? [] })),
}));
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
});
