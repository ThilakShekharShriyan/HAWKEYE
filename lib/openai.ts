// OpenAI Responses API client with the same contract as lib/gemini.ts:
// JSON-only answers, an ordered model list, and short benching of models that
// rate-limit or error so one bad model does not slow every call.
const ENDPOINT = "https://api.openai.com/v1/responses";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

const MODELS = [
  OPENAI_MODEL,
  ...(process.env.OPENAI_FALLBACK_MODELS ?? "gpt-4.1-mini")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
].filter((model, index, all) => all.indexOf(model) === index);

// Reasoning models answer a fridge frame in ~1.8 s with effort "none" and
// ~2.5 s with "low"; perception needs looking, not thinking.
const REASONING_EFFORT = process.env.OPENAI_REASONING ?? "none";
const REASONING_MODELS = /^(gpt-5|o\d)/;
// Frames are 640 px wide. "low" shrinks them further, which turns a can on a
// table a couple of metres away into a few pixels and costs counts; "high"
// is a few thousand more tokens per episode.
const IMAGE_DETAIL = process.env.OPENAI_IMAGE_DETAIL === "low" ? "low" : "high";
const TIMEOUT_MS = 12000;
const BENCH_MS = 30 * 1000;

const benchedUntil = new Map<string, number>();

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type OpenAIResult<T> = {
  data: T;
  model: string;
  usage: { input: number; output: number; total: number };
  latencyMs: number;
};

export function hasOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Nano-class models misread fine visual detail and must not decide identity. */
export const isLiteOpenAIModel = (model: string) => /nano/.test(model);

type Content =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

function toContent(part: Part): Content {
  if ("text" in part) return { type: "input_text", text: part.text };
  return {
    type: "input_image",
    image_url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`,
    detail: IMAGE_DETAIL,
  };
}

async function call(
  model: string,
  key: string,
  system: string,
  parts: Part[],
  timeoutMs: number,
  reasoning: string,
) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      // The system prompt goes in the input (not `instructions`) because JSON
      // mode requires the word "json" to appear in an input message.
      input: [
        { role: "developer", content: [{ type: "input_text", text: system }] },
        { role: "user", content: parts.map(toContent) },
      ],
      text: { format: { type: "json_object" } },
      ...(REASONING_MODELS.test(model) ? { reasoning: { effort: reasoning } } : {}),
      ...(REASONING_MODELS.test(model) ? {} : { temperature: 0.2 }),
      store: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${model} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
}

export async function generateJson<T>({
  system,
  parts,
  timeoutMs = TIMEOUT_MS,
  reasoning = REASONING_EFFORT,
}: {
  system: string;
  parts: Part[];
  timeoutMs?: number;
  /** Reasoning effort for reasoning models; defaults to OPENAI_REASONING or "none". */
  reasoning?: string;
}): Promise<OpenAIResult<T>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const now = Date.now();
  const available = MODELS.filter((model) => (benchedUntil.get(model) ?? 0) <= now);
  const order = available.length ? available : MODELS;
  const failures: string[] = [];

  for (const model of order) {
    const started = performance.now();
    try {
      const body = await call(model, key, system, parts, timeoutMs, reasoning);
      const text =
        body.output
          ?.filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .map((content) => content.text ?? "")
          .join("") ?? "";
      const data = JSON.parse(text) as T;
      benchedUntil.delete(model);
      return {
        data,
        model,
        usage: {
          input: body.usage?.input_tokens ?? 0,
          output: body.usage?.output_tokens ?? 0,
          total: body.usage?.total_tokens ?? 0,
        },
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/ (429|5\d\d):/.test(message)) benchedUntil.set(model, Date.now() + BENCH_MS);
      console.warn(`[openai] ${model} failed: ${message.slice(0, 200)}`);
      failures.push(message);
    }
  }

  throw new Error(`All OpenAI models failed: ${failures.join(" | ")}`);
}
