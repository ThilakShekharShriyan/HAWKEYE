import type { Track } from "@/lib/tracker";

// What to keep of an episode's frames. They are the heavy part of an episode
// (about 40 KB each) and are only worth holding when they show something. The
// call is made after perception, from what the model found and what the
// tracker saw, and is stored with the episode so it can be explained later.

export type Retention = {
  /** "all" every frame sent, "key" the single best frame, "none" no frames. */
  store: "all" | "key" | "none";
  reason: string;
};

export function retention({
  skipped,
  register,
  identity,
  changes,
  tracks,
}: {
  skipped?: string;
  register?: boolean;
  identity?: "known" | "new";
  changes: string[];
  tracks: Track[] | null;
}): Retention {
  if (skipped) return { store: "none", reason: `no matching place (${skipped})` };
  if (register || identity === "new") return { store: "all", reason: "a place was registered" };
  if (changes.length > 0) return { store: "all", reason: `changed: ${changes.length}` };
  const people = tracks?.filter((track) => track.label === "person").length ?? 0;
  if (people > 0) return { store: "key", reason: "someone was in view, nothing changed" };
  return { store: "key", reason: "nothing changed" };
}

/** Indexes (into the frames sent) to store: the model's reference frame for "key", else the last frame. */
export function framesToStore(policy: Retention, frameCount: number, referenceFrame?: number | null) {
  if (policy.store === "none" || frameCount === 0) return [];
  if (policy.store === "all") return Array.from({ length: frameCount }, (_, index) => index);
  const reference = typeof referenceFrame === "number" ? referenceFrame - 1 : -1;
  return [reference >= 0 && reference < frameCount ? reference : frameCount - 1];
}
