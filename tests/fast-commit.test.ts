import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FastCommit, touches, type Box, type LiveFrame, type TrackedObject } from "../lib/fast-commit";

const clip: LiveFrame[] = JSON.parse(readFileSync(new URL("./fixtures/bottle-clip-tracks.json", import.meta.url), "utf8"));

function run(frames: LiveFrame[]) {
  const machine = new FastCommit();
  return frames.flatMap((frame) => machine.push(frame).map((delta) => ({ ...delta, firedAt: frame.at })));
}

// Synthetic frames, 250 ms apart. Boxes are normalised; a person overlapping
// the bottle at [0.4..0.5] touches it, one at [0.8..0.95] does not.
const bottleAt = (x: number): TrackedObject => ({ label: "bottle", box: [x, 0.5, x + 0.08, 0.7] });
const hand = (x: number): TrackedObject => ({ label: "person", box: [x, 0.45, x + 0.15, 0.95] });
const frames = (n: number, objects: TrackedObject[], from = 0): LiveFrame[] =>
  Array.from({ length: n }, (_, i) => ({ at: (from + i) * 250, objects }));

describe("fast commit on the real bottle clip", () => {
  it("proves exactly one change: 2 bottles to 1, within a second of the hand leaving", () => {
    const deltas = run(clip);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ label: "bottle", before: 2, after: 1 });
    // The arm was last seen at 10.76 s; the change is proven by about 11.3 s.
    const lastArm = Math.max(...clip.filter((f) => f.objects.some((o) => o.label === "person")).map((f) => f.at));
    expect(lastArm).toBeGreaterThan(10_500);
    expect(deltas[0].firedAt - lastArm).toBeLessThanOrEqual(1000);
  });

  it("is quiet while only the first seconds (two bottles, no hand) play", () => {
    expect(run(clip.filter((f) => f.at < 8_000))).toEqual([]);
  });
});

describe("fast commit rules", () => {
  const twoBottles = [bottleAt(0.4), bottleAt(0.5)];

  it("fires when the hand touched a bottle and the count dropped", () => {
    const seq = [
      ...frames(7, twoBottles),
      ...frames(3, [...twoBottles, hand(0.45)], 7),
      ...frames(3, [bottleAt(0.4)], 10),
    ];
    expect(run(seq)).toMatchObject([{ label: "bottle", before: 2, after: 1 }]);
  });

  it("fires for something put down: the count rises", () => {
    const seq = [
      ...frames(7, [bottleAt(0.4)]),
      ...frames(3, [bottleAt(0.4), bottleAt(0.5), hand(0.45)], 7),
      ...frames(3, twoBottles, 10),
    ];
    expect(run(seq)).toMatchObject([{ label: "bottle", before: 1, after: 2 }]);
  });

  it("ignores a count change the hand never touched (a pan, or a bottle out of frame)", () => {
    const seq = [
      ...frames(7, twoBottles),
      ...frames(3, [...twoBottles, hand(0.82)], 7),
      ...frames(3, [bottleAt(0.4)], 10),
    ];
    expect(run(seq)).toEqual([]);
  });

  it("ignores a one-frame person blip", () => {
    const seq = [...frames(7, twoBottles), ...frames(1, [...twoBottles, hand(0.45)], 7), ...frames(4, [bottleAt(0.4)], 8)];
    expect(run(seq)).toEqual([]);
  });

  it("does nothing when the count is the same after the hand leaves", () => {
    const seq = [...frames(7, twoBottles), ...frames(3, [...twoBottles, hand(0.45)], 7), ...frames(3, twoBottles, 10)];
    expect(run(seq)).toEqual([]);
  });

  it("does not trust a baseline that was flickering", () => {
    const flicker = [
      ...frames(1, twoBottles),
      ...frames(1, [bottleAt(0.4)], 1),
      ...frames(1, twoBottles, 2),
      ...frames(1, [bottleAt(0.4)], 3),
      ...frames(1, twoBottles, 4),
      ...frames(1, [bottleAt(0.4)], 5),
    ];
    const seq = [...flicker, ...frames(3, [...twoBottles, hand(0.45)], 6), ...frames(3, [bottleAt(0.4)], 9)];
    expect(run(seq)).toEqual([]);
  });

  it("waits for the after-count to be steady across the frames that end the reach", () => {
    const seq = [
      ...frames(7, twoBottles),
      ...frames(3, [...twoBottles, hand(0.45)], 7),
      ...frames(1, [bottleAt(0.4)], 10),
      ...frames(1, twoBottles, 11), // the bottle reappears: the two after-frames disagree
    ];
    expect(run(seq)).toEqual([]);
  });

  it("handles two reaches in a row", () => {
    const seq = [
      ...frames(7, twoBottles),
      ...frames(3, [...twoBottles, hand(0.45)], 7),
      ...frames(7, [bottleAt(0.4)], 10),
      ...frames(3, [bottleAt(0.4), hand(0.35)], 17),
      ...frames(3, [], 20),
    ];
    expect(run(seq).map((d) => [d.before, d.after])).toEqual([[2, 1], [1, 0]]);
  });
});

describe("touches", () => {
  const a: Box = [0.4, 0.4, 0.6, 0.6];
  it("is true for real overlap and false for a gap or a graze", () => {
    expect(touches(a, [0.5, 0.5, 0.8, 0.8])).toBe(true);
    expect(touches(a, [0.7, 0.7, 0.9, 0.9])).toBe(false);
    expect(touches(a, [0.59, 0.59, 0.9, 0.9])).toBe(false);
  });
});

describe("two reaches close together", () => {
  it("records the second reach even when only the settled frames separate them", () => {
    const two = [bottleAt(0.4), bottleAt(0.5)];
    const one = [bottleAt(0.4)];
    const touching = (bottles: TrackedObject[]) => [...bottles, hand(0.42)];
    const seq = [
      ...frames(7, two),
      ...frames(3, touching(two), 7),
      ...frames(2, one, 10), // the settled frames that end reach one and seed the next baseline
      ...frames(3, touching(one), 12),
      ...frames(2, [], 15),
    ];
    const deltas = run(seq);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ label: "bottle", before: 2, after: 1 });
    expect(deltas[1]).toMatchObject({ label: "bottle", before: 1, after: 0 });
  });

  it("still ignores a first reach with too few calm frames before it", () => {
    const two = [bottleAt(0.4), bottleAt(0.5)];
    const seq = [...frames(2, two), ...frames(3, [...two, hand(0.42)], 2), ...frames(2, [bottleAt(0.4)], 5)];
    expect(run(seq)).toEqual([]);
  });
});
