import { describe, expect, it } from "vitest";
import { framesToStore, retention } from "../lib/retention";
import { remapTracks, type Track } from "../lib/tracker";

const track = (over: Partial<Track>): Track => ({
  id: 1, label: "person", frames: [0], firstBox: [0, 0, 1, 1], lastBox: [0, 0, 1, 1], maxConfidence: 0.9, ...over,
});

describe("retention", () => {
  it("stores nothing for an episode that matched no place", () => {
    expect(retention({ skipped: "unregistered", changes: [], tracks: null }).store).toBe("none");
    expect(retention({ skipped: "unsure", changes: ["x"], tracks: null }).store).toBe("none");
  });

  it("keeps every frame when a place was registered or something changed", () => {
    expect(retention({ register: true, changes: [], tracks: null }).store).toBe("all");
    expect(retention({ identity: "new", changes: [], tracks: null }).store).toBe("all");
    const changed = retention({ identity: "known", changes: ["-1 coke can"], tracks: [track({})] });
    expect(changed).toEqual({ store: "all", reason: "changed: 1" });
  });

  it("keeps one key frame when nothing changed, and says whether someone was in view", () => {
    expect(retention({ identity: "known", changes: [], tracks: [track({})] })).toEqual({
      store: "key",
      reason: "someone was in view, nothing changed",
    });
    expect(retention({ identity: "known", changes: [], tracks: [track({ label: "laptop" })] }).reason).toBe("nothing changed");
    expect(retention({ identity: "known", changes: [], tracks: null }).store).toBe("key");
  });
});

describe("framesToStore", () => {
  it("maps each policy onto frame indexes", () => {
    expect(framesToStore({ store: "all", reason: "" }, 3)).toEqual([0, 1, 2]);
    expect(framesToStore({ store: "none", reason: "" }, 3)).toEqual([]);
    expect(framesToStore({ store: "key", reason: "" }, 4)).toEqual([3]);
    expect(framesToStore({ store: "key", reason: "" }, 4, 2)).toEqual([1]);
  });

  it("falls back to the last frame for an unusable reference", () => {
    expect(framesToStore({ store: "key", reason: "" }, 4, 9)).toEqual([3]);
    expect(framesToStore({ store: "key", reason: "" }, 4, 0)).toEqual([3]);
    expect(framesToStore({ store: "key", reason: "" }, 4, null)).toEqual([3]);
    expect(framesToStore({ store: "all", reason: "" }, 0)).toEqual([]);
  });
});

describe("remapTracks", () => {
  it("re-indexes tracks onto the frames the model sees and drops the rest", () => {
    const result = remapTracks(
      [track({ id: 1, frames: [0, 1, 4] }), track({ id: 2, frames: [2, 3] }), track({ id: 3, frames: [5] })],
      [0, 2, 4],
    );
    expect(result?.map((t) => [t.id, t.frames])).toEqual([[1, [0, 2]], [2, [1]]]);
  });

  it("passes null through", () => {
    expect(remapTracks(null, [0, 1])).toBeNull();
  });
});
