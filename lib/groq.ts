import { errorText, log } from "@/lib/log";

// Groq as a model provider: answers in well under a second. Each free key
// allows 8,000 tokens a minute, so calls rotate across GROQ_API_KEYS and a
// rate-limited key is rested for a minute. Text goes to GROQ_MODEL; anything
// with photos goes to GROQ_VISION_MODEL, which accepts MAX_IMAGES images per
// call, so callers trim what they send (see imageBudget).

const URL = "https://api.groq.com/openai/v1/chat/completions";
const TEXT_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b";
const TIMEOUT_MS = 8000;
const REST_MS = 60_000;
export const MAX_IMAGES = 3;

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

const keys = (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const restingUntil = new Map<number, number>();
let cursor = 0;

export const hasGroq = () => keys.length > 0;
export const groqKeyCount = () => keys.length;

/** Order to try keys in: round-robin from the cursor, skipping rested ones. */
export function keyOrder(count: number, start: number, resting: Map<number, number>, now: number) {
  return Array.from({ length: count }, (_, offset) => (start + offset) % count).filter(
    (index) => (resting.get(index) ?? 0) <= now,
  );
}

/**
 * Which photos to send when only `max` fit: `refs[i]` reference photos of
 * candidate i, and the indexes of the episode frames to keep. Change is read
 * from the first and last frame, so those always go; what is left over buys
 * one reference photo for the first candidates (callers put the likeliest
 * first), then middle frames.
 */
export function imageBudget(max: number, referenceCounts: number[], frameCount: number) {
  const total = referenceCounts.reduce((sum, count) => sum + count, 0) + frameCount;
  if (total <= max) {
    return { refs: referenceCounts, frames: Array.from({ length: frameCount }, (_, index) => index) };
  }
  const keep = new Set<number>();
  if (frameCount > 0) keep.add(frameCount - 1);
  if (frameCount > 1 && keep.size < max) keep.add(0);
  let left = max - keep.size;
  const refs = referenceCounts.map((count) => {
    if (left <= 0 || count === 0) return 0;
    left -= 1;
    return 1;
  });
  // Spare slots go to evenly spaced middle frames.
  for (let slot = 1; left > 0 && keep.size < frameCount; slot++) {
    const index = Math.round((slot * (frameCount - 1)) / (left + 1));
    if (!keep.has(index)) {
      keep.add(index);
      left -= 1;
    } else if (slot > frameCount) break;
  }
  return { refs, frames: [...keep].sort((a, b) => a - b) };
}

class TooLarge extends Error {}

export type GroqResult<T> = {
  data: T;
  model: string;
  usage: { input: number; output: number; total: number };
  latencyMs: number;
};

function toContent(part: Part) {
  if ("text" in part) return { type: "text", text: part.text };
  return {
    type: "image_url",
    image_url: { url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}` },
  };
}

/** JSON from Groq. Throws when no key could answer, so the caller can fall back. */
export async function generateJson<T>({
  system,
  parts,
  timeoutMs = TIMEOUT_MS,
}: {
  system: string;
  parts: Part[];
  timeoutMs?: number;
  reasoning?: string;
}): Promise<GroqResult<T>> {
  if (keys.length === 0) throw new Error("GROQ_API_KEYS is not set");
  const images = parts.filter((part) => "inline_data" in part).length;
  if (images > MAX_IMAGES) throw new Error(`groq: ${images} images, at most ${MAX_IMAGES} fit`);
  const model = images > 0 ? VISION_MODEL : TEXT_MODEL;
  const started = performance.now();
  const order = keyOrder(keys.length, cursor, restingUntil, Date.now());
  cursor = (cursor + 1) % keys.length;
  let last = "every key is resting after a rate limit";

  for (const index of order) {
    try {
      const response = await fetch(URL, {
        method: "POST",
        signal: AbortSignal.timeout(Math.min(timeoutMs, TIMEOUT_MS)),
        headers: { Authorization: `Bearer ${keys[index]}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            // Text-only requests use a plain string: the text model rejects parts.
            {
              role: "user",
              content: images > 0 ? parts.map(toContent) : parts.map((part) => ("text" in part ? part.text : "")).join("\n"),
            },
          ],
          response_format: { type: "json_object" },
          // The vision model allows 1,000 output tokens a minute per key.
          max_completion_tokens: images > 0 ? 900 : 1200,
          temperature: 0.2,
        }),
      });
      if (response.status === 429 || response.status === 413) {
        const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
        // "Request too large" is about this request, not the key: every key
        // would refuse it, and resting them would starve later small calls.
        if (/too large/i.test(detail)) {
          log("groq", "request too large for the per-minute limit", { model, images, detail });
          throw new TooLarge(detail);
        }
        restingUntil.set(index, Date.now() + REST_MS);
        last = `key ${index + 1} rate limited`;
        log("groq", "key rate limited, resting it for a minute", { key: index + 1, model, detail });
        continue;
      }
      if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 200)}`);
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const data = JSON.parse(body.choices?.[0]?.message?.content ?? "") as T;
      const latencyMs = Math.round(performance.now() - started);
      log("groq", "ok", { key: index + 1, model, images, tokens: body.usage?.total_tokens, ms: latencyMs });
      return {
        data,
        model: `groq:${model}`,
        usage: {
          input: body.usage?.prompt_tokens ?? 0,
          output: body.usage?.completion_tokens ?? 0,
          total: body.usage?.total_tokens ?? 0,
        },
        latencyMs,
      };
    } catch (cause) {
      if (cause instanceof TooLarge) throw new Error(`groq: ${cause.message}`);
      last = `key ${index + 1}: ${errorText(cause)}`;
      log("groq", "call failed", { key: index + 1, model, error: errorText(cause) });
    }
  }
  throw new Error(`groq: ${last}`);
}
