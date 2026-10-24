// Fast path for things the detector knows (bottles, cups, laptops, bags): the
// live tracker sees a hand reach in and leave, and the count of an object it
// touched has changed. That is enough to record the change within a second,
// without waiting for the vision model; the slower perception episode still
// runs afterwards and corrects anything this got wrong.
//
// Pure and deterministic: it consumes one frame's tracked objects at a time.

export type Box = [number, number, number, number];
export type TrackedObject = { label: string; box: Box };
export type LiveFrame = { at: number; objects: TrackedObject[] };

export type Delta = {
  label: string;
  /** Typical count before the hand came in, and after it left. */
  before: number;
  after: number;
  /** When the hand first appeared, so a commit can tell whether something else already recorded this. */
  startedAt: number;
};

/** Frames of calm before the hand that set the baseline count. */
const BASELINE_FRAMES = 6;
/** Frames with no person in a row that end an interaction, and that must agree on the count. */
const ABSENT_FRAMES = 2;
/** The hand must be seen this many frames to count as a reach rather than a detector blip. */
const MIN_PERSON_FRAMES = 2;
/** A baseline is only trusted when at least this many of its frames agree. */
const BASELINE_AGREE = 5;
/** Give up on an interaction that never ends (a person standing in view). */
const MAX_INTERACTION_FRAMES = 80;

const area = ([x1, y1, x2, y2]: Box) => Math.max(0, x2 - x1) * Math.max(0, y2 - y1);

/** True when the two boxes overlap by any real amount: a hand holding or lifting the thing. */
export function touches(a: Box, b: Box) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return false;
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 && (w * h) / smaller >= 0.1;
}

const countOf = (frame: LiveFrame, label: string) => frame.objects.filter((object) => object.label === label).length;
const hasPerson = (frame: LiveFrame) => frame.objects.some((object) => object.label === "person");

/** The count that most frames agree on, and how many did. */
function mode(counts: number[]) {
  const tally = new Map<number, number>();
  for (const count of counts) tally.set(count, (tally.get(count) ?? 0) + 1);
  let best = { value: 0, frames: 0 };
  for (const [value, frames] of tally) if (frames > best.frames) best = { value, frames };
  return best;
}

export class FastCommit {
  private calm: LiveFrame[] = [];
  private baseline: LiveFrame[] | null = null;
  private interaction: LiveFrame[] = [];
  private absent: LiveFrame[] = [];
  private startedAt = 0;
  /** True once a reach has ended, so the calm frames after it came from a settled window. */
  private seeded = false;

  /** Feed one frame; returns the changes this frame proves, usually none. */
  push(frame: LiveFrame): Delta[] {
    const person = hasPerson(frame);

    if (this.baseline === null) {
      if (!person) {
        this.calm.push(frame);
        if (this.calm.length > BASELINE_FRAMES) this.calm.shift();
        return [];
      }
      // A hand just appeared: freeze what the scene looked like just before it.
      this.baseline = [...this.calm];
      this.interaction = [frame];
      this.absent = [];
      this.startedAt = frame.at;
      return [];
    }

    if (person) {
      this.interaction.push(frame);
      this.absent = [];
      if (this.interaction.length > MAX_INTERACTION_FRAMES) this.reset();
      return [];
    }

    this.absent.push(frame);
    if (this.absent.length < ABSENT_FRAMES) return [];

    const deltas = this.decide();
    this.reset();
    return deltas;
  }

  private decide(): Delta[] {
    const baseline = this.baseline ?? [];
    const people = this.interaction.filter(hasPerson).length;
    // A baseline built from the window that just ended a reach is short when
    // another reach follows soon: it counts if every one of its frames agrees.
    const need = this.seeded ? Math.min(BASELINE_AGREE, Math.max(ABSENT_FRAMES, baseline.length)) : BASELINE_AGREE;
    if (people < MIN_PERSON_FRAMES || baseline.length < need) return [];

    const labels = new Set(
      [...baseline, ...this.interaction, ...this.absent].flatMap((frame) =>
        frame.objects.filter((object) => object.label !== "person").map((object) => object.label),
      ),
    );
    const deltas: Delta[] = [];
    for (const label of labels) {
      const before = mode(baseline.map((frame) => countOf(frame, label)));
      const after = mode(this.absent.map((frame) => countOf(frame, label)));
      // Both windows must be steady, and the count must have changed.
      if (before.frames < need || after.frames < this.absent.length) continue;
      if (before.value === after.value) continue;
      // Only things the hand touched: a camera pan that drops a bottle out of
      // frame changes the count but touched nothing.
      const touched = this.interaction.some((frame) =>
        frame.objects.some(
          (object) =>
            object.label === label &&
            frame.objects.some((other) => other.label === "person" && touches(object.box, other.box)),
        ),
      );
      if (!touched) continue;
      deltas.push({ label, before: before.value, after: after.value, startedAt: this.startedAt });
    }
    return deltas;
  }

  private reset() {
    // The scene after the hand left is the start of the next baseline.
    this.calm = this.absent.slice(-BASELINE_FRAMES);
    this.seeded = true;
    this.baseline = null;
    this.interaction = [];
    this.absent = [];
  }
}
