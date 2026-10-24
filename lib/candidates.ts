import { normName } from "@/lib/inventory";

/** Identity letters in the perception prompt run A to F, so a sighting is compared with at most six places. */
export const MAX_CANDIDATES = 6;

type Named = { name: string };

/**
 * The places a sighting is compared with: the most recently seen ones, plus the
 * place the dashboard's anchor match names, however long ago it was last seen.
 * The anchored place takes one of the six slots (the least recent candidate
 * makes room) so the list never outgrows the identity letters.
 */
export function withAnchoredPlace<T extends Named>(recent: T[], anchored: T | null, max = MAX_CANDIDATES): T[] {
  const capped = recent.slice(0, max);
  if (!anchored || capped.some((place) => place.name === anchored.name)) return capped;
  return [...capped.slice(0, max - 1), anchored];
}

/** The places a sighting is compared with, in the order the prompt letters them A to F: anchored place first. */
export function candidatesFor<T extends Named>(recent: T[], anchored: T | null, anchorName?: string | null): T[] {
  return anchoredFirst(withAnchoredPlace(recent, anchored), anchorName);
}

/** The anchored place first, so its reference photo survives the model's image budget. Names compare normalised. */
export function anchoredFirst<T extends Named>(places: T[], anchorName?: string | null): T[] {
  const wanted = anchorName ? normName(anchorName) : null;
  if (!wanted) return places;
  return [...places].sort((a, b) => Number(normName(b.name) === wanted) - Number(normName(a.name) === wanted));
}
