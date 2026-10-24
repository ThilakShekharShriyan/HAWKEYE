import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { ObserverId } from "@/lib/types";
import { TRUEFORGE_AGENT_NAME, worldstateAgentSpec } from "@/lib/trueforge-agent";

// Questions about stored state go to the TrueForge agent started with
// `npx @truefoundry/trueforge` and registered by `npm run trueforge:setup`.
// The SDK opens a session and streams the turn. The graph context is in the
// message because the harness does not have the camera. Without
// TRUEFORGE_AGENT=1, or when the call fails, /api/ask answers in-process.

const BASE = (process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.ANSWER_AGENT_TIMEOUT_MS ?? 25_000);
const MODEL = process.env.TRUEFORGE_MODEL ?? "openai/gpt-5-4-mini";

export function hasAnswerAgent() {
  return /^(1|true|on)$/i.test(process.env.TRUEFORGE_AGENT ?? "");
}

// "Remember this", "register this fridge", "don't record that" need the photo
// and write state, which stays in the app; everything else is a question.
const NOT_A_QUESTION =
  /\b(remember|register|note (?:that|this|down)|forget|don'?t record|do not record|stop recording|go private|this is (?:my|the|our))\b/i;

// "What am I looking at", "what is this", "how many are here": only the photo
// answers these, and the deployed agent is text-only.
const ABOUT_THE_VIEW =
  /\b(looking at|see(?:ing)?|in front of|this|that|these|those|here|holding|pointing|where am i|where are we|(?:what|which) (?:place|room|spot))\b/i;

/** True when only the camera photo can answer ("what is this", "where am I"). */
export function isAboutTheView(text: string) {
  return ABOUT_THE_VIEW.test(text);
}

export function isQuestion(text: string) {
  return !NOT_A_QUESTION.test(text);
}

/** True for questions the agent can answer from stored state, without the camera. */
export function isStoredStateQuestion(text: string) {
  return isQuestion(text) && !ABOUT_THE_VIEW.test(text);
}

/** Joins the text chunks of an invokeStream body ("data: {json}" lines). */
export function parseAgentStream(body: string) {
  let text = "";
  let suspended = false;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      const chunk = JSON.parse(trimmed.slice(5)) as {
        chunk_type?: string;
        content?: unknown;
        metadata?: { status?: string };
      };
      if (chunk.chunk_type === "text" && typeof chunk.content === "string") text += chunk.content;
      if (chunk.chunk_type === "done" && chunk.metadata?.status === "suspended") suspended = true;
    } catch {
      // Keep-alives and partial lines are not JSON.
    }
  }
  return { text: text.trim(), suspended };
}

type TurnEvent = {
  type?: string;
  content?: unknown;
  state?: { status?: string; output?: { content?: unknown } | null };
};

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

/** Spoken answer from a TrueForge turn: deltas while it streams, the final message when the turn is done. */
export function answerFromEvents(events: TurnEvent[]) {
  let streamed = "";
  let final = "";
  let suspended = false;
  for (const event of events) {
    if (event.type === "model.message.delta") streamed += textOf(event.content);
    if (event.type === "turn.done") {
      const status = event.state?.status;
      if (status && status !== "done") suspended = true;
      final = textOf(event.state?.output?.content) || final;
    }
  }
  return { text: (final || streamed).trim(), suspended };
}

function forge() {
  return new TrueForge({
    baseUrl: BASE,
    timeoutInSeconds: Math.max(1, Math.ceil(TIMEOUT_MS / 1000)),
    maxRetries: 0,
    ...(process.env.TRUEFORGE_TOKEN ? { token: process.env.TRUEFORGE_TOKEN } : {}),
  });
}

function statusOf(error: unknown) {
  return typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
}

/** The agent's spoken answer, or null when it is not configured or did not answer in time. */
export async function askAnswerAgent(text: string, observerId: ObserverId, context: string) {
  if (!hasAnswerAgent()) return null;
  const started = performance.now();
  const client = forge();
  try {
    let sessionId: string;
    try {
      const saved = await client.sessions.create({ agent: { name: TRUEFORGE_AGENT_NAME } });
      sessionId = saved.data.id;
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      const inline = await client.sessions.create({
        agent: { spec: worldstateAgentSpec({ model: MODEL }) },
      });
      sessionId = inline.data.id;
    }
    const stream = await client.sessions.createTurnStream(sessionId, {
      input: [{ type: "user.message", content: `Observer ${observerId} asks: ${text}\n\n${context}` }],
    });
    const events: TurnEvent[] = [];
    for await (const message of stream.withMetadata()) events.push(message.data as TurnEvent);
    const { text: answer, suspended } = answerFromEvents(events);
    if (!answer || suspended) return null;
    return { answer, latencyMs: Math.round(performance.now() - started) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[answer-agent] falling back: ${message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 240)}`);
    return null;
  }
}
