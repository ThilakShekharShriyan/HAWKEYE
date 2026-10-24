import { EMBED_DIM } from "@/lib/graph";

const MODEL = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";

/** Query and event vectors for FalkorDB's cosine index. Null when OpenAI is unset. */
export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  const input = text.trim();
  if (!key || input.length < 2) return null;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    signal: AbortSignal.timeout(4000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input, dimensions: EMBED_DIM }),
  });
  if (!response.ok) {
    throw new Error(`embed ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }
  const body = (await response.json()) as { data?: { embedding?: number[] }[] };
  const embedding = body.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBED_DIM) return null;
  return embedding;
}
