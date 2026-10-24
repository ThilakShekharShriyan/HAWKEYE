import { createHash } from "node:crypto";
import { cacheRead, cacheWrite } from "@/lib/world-store";

// Perception results keyed by the perceptual hashes of the keyframes that
// produced them. A static phone pointed at a fridge re-triggers an episode
// every ~65s with visually identical frames; those hit here instead of the model.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function cacheKey(promptVersion: string, hashes: string[]) {
  return createHash("sha256")
    .update(`${promptVersion}|${[...hashes].sort().join(",")}`)
    .digest("hex");
}

function usable(hashes: (string | undefined)[]): hashes is string[] {
  return hashes.length > 0 && hashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{16}$/.test(hash));
}

/**
 * Exact matches only: a fridge with one carton removed differs from the full
 * fridge by about one bit of dHash, so near-duplicate matching would replay
 * the old inventory.
 */
export async function lookupPerception<T>(
  promptVersion: string,
  hashes: (string | undefined)[],
): Promise<{ perceived: T; model: string } | null> {
  if (!usable(hashes)) return null;
  return cacheRead<T>(cacheKey(promptVersion, hashes));
}

export async function rememberPerception<T>(
  promptVersion: string,
  hashes: (string | undefined)[],
  perceived: T,
  model: string,
) {
  if (!usable(hashes)) return;
  const now = Date.now();
  await cacheWrite(cacheKey(promptVersion, hashes), promptVersion, perceived, model, new Date(now + CACHE_TTL_MS));
}
