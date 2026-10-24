import { recallContext, recordTurn, rememberFact } from "@/lib/agent-memory";
import { askAnswerAgent, hasAnswerAgent, isAboutTheView, isStoredStateQuestion } from "@/lib/answer-agent";
import { hasBrightData, searchShopping } from "@/lib/bright-data";
import { episodesSettled, outstanding } from "@/lib/episode-queue";
import { insertEvent } from "@/lib/events-repo";
import { generateJson, hasModel, maxImages, MISSING_KEY_MESSAGE, provider } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import { retrieveMemories } from "@/lib/memory";
import { listContainers, openPrivacyWindow, perceiveEpisode, siteReferences } from "@/lib/perception";
import { cameraLabel, OBSERVER_KEY } from "@/lib/observers";
import { isObserverId } from "@/lib/signal-store";
import type { ObserverId } from "@/lib/types";
import { hasWords } from "@/lib/wake";
import { formatTrends, shoppingList } from "@/lib/trends";
import { loadTrends } from "@/lib/trends-repo";
import { formatWorldState } from "@/lib/world-state";
import { highlightThings, readScene, saveHighlight, type PlaceScene } from "@/lib/scene";

type AskBody = {
  observerId?: string;
  text?: string;
  image?: string;
};

type Decision = {
  view?: string | null;
  matchedPlace?: string | null;
  intent: "question" | "remember" | "ignore";
  answer: string;
  memory?: string;
  anchor?: string | null;
};

const SYSTEM = `You are WORLDSTATE, a spatial memory assistant worn by a person as a phone camera.
The user spoke to you after saying the wake phrase "Hey World".
You receive: their utterance, an optional photo of what their camera sees right now, and memories retrieved from earlier observations.

Classify the utterance:
- "remember": they ask you to remember/note something. Put a clean standalone fact in "memory" (include objects, places, people; resolve "this"/"here" using the photo). "answer" is a short confirmation.
  If what they want remembered is a place, landmark, container or fixed object the camera is looking at right now ("register this", "register this fridge", "remember this fridge", "remember this place", "remember this spot", "remember where I am", "remember my wardrobe", "this is the garage fridge", "this is Thilak's desk"), also set "anchor" to a short lowercase name for it, using their words when they give one ("garage fridge") and otherwise what the photo shows ("fridge", "wardrobe", "pantry shelf", "front door", "whiteboard corner", "sofa"); otherwise "anchor" is null. "remember this place" with no name gets the most recognisable fixed thing in the photo as its name, never "place". "register this" always counts as "remember". A bare "remember this" while the camera looks at a table, desk, shelf, counter or fridge is such a request: name it from the photo ("table").
  If what they want remembered is a movable thing the photo shows resting somewhere ("remember my laptop", "remember where I put my keys", or a bare "remember this" while the camera looks at a laptop on a chair), the place it rests on is what must be watched: set "anchor" to that place ("chair", "sofa", "side table"), so that it is tracked and its being taken is noticed. "memory" then says whose thing it is and where it is ("Thilak's laptop is on the chair in the lounge"). Whenever a photo is attached to a "remember" request, "anchor" is null only if nothing in the photo is a place or a thing resting on one (a pure fact such as "remember the wifi password is …").
  When "anchor" is set and the request was about the place itself, "memory" says what the site is and where ("There is a wooden table in the office that WORLDSTATE watches"), never what is on or in it right now: contents change and are tracked separately.
- "ignore": they ask you not to record / forget / go private. "answer" is a short confirmation.
- "question": anything else. When REGISTERED PLACES photos are attached, first compare the current photo with each reference photo. Only if the current photo is mainly a view of that same physical place or object, say its name ("You're at the whiteboard corner") for "where am I", "what place is this" or "what am I looking at". Being in the same room, or having only an edge of it in frame, is not a match: then say what the photo actually shows, that it is not a place you were asked to remember, and, if a remembered place is partly visible, that it is next to it. Never name a remembered place just because it is the only one you know. Answer using the current world state, the photo and memories. For what is in or on a site (table, fridge, shelf) the world state is the truth, wherever the person is standing now: "coke can ×2" means two; an item not listed is not there now, so "how many" is zero, even if memories mention it; a "taken" or "gone from" event means it left. Answer "how many … are left" with the number from the world state and, when the last change explains it, who was seen taking one and when. Mention which observer last changed or checked something and when, if useful. If you do not know, say so briefly.

  Match what they ask about loosely to what is recorded: "a snack" covers a candy bar, a snack packet or a bag of chips; "a drink" covers a coke can. A recorded removal answers "who took …". When the record names a person ("Arnav took …", "taken by Arnav", "probably Arnav"), say that person took it. When it only says which camera saw it, say "someone took it, seen by Arnav's camera at …" rather than denying it or naming the camera's owner as the taker.
  Only food, drink and household supplies are things to buy or to call "running low"; never suggest buying or replacing a laptop, a bag or other belongings, whatever the trends say about them.
  When asked what changed last, compare the dates as well as the times: a change today is later than any change on an earlier day.
  For "what should I buy", "what are we running low on", "how fast do we go through …" or "is anything going off", use the usage trends: lines marked BUY are the shopping list; give the pace in plain words ("about two a day"). Freshness is an estimate from the kind of item and how long it has been there, not a printed date, so say "probably" and suggest checking.
  For "did I already take …", "where did I put …", "when did I last …" (the person may be forgetful), answer calmly and concretely from the last recorded change: what, where, when, and who was seen doing it. If nothing was recorded, say you did not see it rather than guessing.

Every registered place keeps its own state in the world state below (the fridge has its contents, the snack table has its own). Work out which place or places the question is about; if it names none, use the place that holds the thing asked about, and if several do, give each. Never mix one place's contents into another's.
Every change is tagged with the camera that saw it. Call observers by whose camera it is (the key is given below), e.g. "one candy bar was taken, seen by Arnav's camera at 15:31", never "observer 02".

The answer is spoken aloud: one or two short sentences, no markdown, no lists.
When a photo is attached, fill "view" before anything else: a few words naming the main thing the photo shows ("kitchen counter with onions and a flask", "open fridge"). Then "matchedPlace": the name of the registered place whose reference photo shows that same main thing, or null. An answer may only say the person is at a remembered place when "matchedPlace" is not null.
Respond with JSON: {"view": "..." | null, "matchedPlace": "..." | null, "intent": "...", "answer": "...", "memory": "...", "anchor": "..." | null}`;

/** The newest recorded change across all places, spelled out so no model has to compare timestamps. */
function latestChange(sites: Awaited<ReturnType<typeof listContainers>>) {
  const latest = sites
    .filter((site) => site.lastChange)
    .sort((a, b) => new Date(b.lastChange!.at).getTime() - new Date(a.lastChange!.at).getTime())[0];
  if (!latest?.lastChange) return "none recorded";
  const { summary, by, at } = latest.lastChange;
  return `${latest.name}: ${summary}, seen by ${cameraLabel(by)} at ${new Date(at).toLocaleString("en-GB")}`;
}

/** FAST_ANSWERS=1 on Groq: stored-state questions skip the TrueForge hop. */
const fastAnswers = () => provider() === "groq" && /^(1|true|on)$/i.test(process.env.FAST_ANSWERS ?? "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as AskBody;
  const text = body.text?.trim();
  if (!text || !hasWords(text)) {
    return Response.json({ error: "Say a full question after \u201cHey World\u201d." }, { status: 400 });
  }
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (!hasModel()) {
    return Response.json(
      { error: MISSING_KEY_MESSAGE },
      { status: 503 },
    );
  }

  const observerId = body.observerId;
  const started = performance.now();
  try {
    return await answer(observerId, text, body.image, started);
  } catch (cause) {
    // Return JSON rather than the framework's HTML 500 so the phone can speak
    // a short failure message instead of "couldn't reach WORLDSTATE".
    console.error("/api/ask failed", cause);
    log("ask", "failed", { observer: observerId, text, error: errorText(cause) });
    return Response.json(
      {
        error: "I couldn't think that through just now. Please try again.",
        detail: cause instanceof Error ? cause.message : String(cause),
      },
      { status: 502 },
    );
  }
}

async function answer(
  observerId: ObserverId,
  text: string,
  rawImage: string | undefined,
  started: number,
) {
  // Someone may have just taken the thing being asked about: let an episode
  // that is being captured or read finish before looking at the state.
  const pending = outstanding();
  if (pending.inFlight || pending.expected) {
    const waited = await episodesSettled(5000);
    log("ask", "held for an episode in progress", { observer: observerId, text, ...pending, waitedMs: waited });
  }

  const [{ mode, memories }, containers, trends, longTerm] = await Promise.all([
    retrieveMemories(text),
    listContainers(),
    loadTrends().catch(() => []),
    // Facts, past episodes and vocabulary kept in the graph across sessions.
    recallContext(text, observerId),
  ]);
  const shopping = /\b(buy|shopping|running low|restock|where (?:can|do) i (?:get|buy))\b/i.test(text);
  const offers =
    shopping && hasBrightData()
      ? await searchShopping(shoppingList(trends).map((row) => row.item)).catch((cause) => {
          log("ask", "bright data failed", { error: errorText(cause) });
          return [];
        })
      : [];
  const image = rawImage?.replace(/^data:image\/\w+;base64,/, "");
  // Recognising a remembered place needs its photo next to the current one.
  const places =
    image && isAboutTheView(text)
      ? await siteReferences(Math.min(4, maxImages() - 1)).catch(() => [])
      : [];
  const worldState = formatWorldState(containers);
  const pictures = (
    await Promise.all(
      containers.map(async (site) => {
        try {
          return { key: site.key, name: site.name, scene: await readScene(site.key, site.name) };
        } catch (cause) {
          log("ask", "scene unreadable", { place: site.name, error: errorText(cause) });
          return null;
        }
      }),
    )
  ).filter((row): row is { key: string; name: string; scene: PlaceScene } => row !== null);
  const sceneText = pictures
    .map((row) => {
      const live = row.scene.slots.flatMap((slot) => slot.things).map((thing) => `${thing.kind} in ${thing.slot}`);
      const gone = row.scene.ghosts.map(
        (thing) => `${thing.kind} from ${thing.slot}, taken by observer ${thing.takenBy ?? "?"}`,
      );
      const lines = [...live.map((line) => `live ${line}`), ...gone.map((line) => `ghost ${line}`)];
      return lines.length ? `- ${row.name}: ${lines.join("; ")}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const context = [
    `Now: ${new Date().toString()}`,
    `Observer asking: ${observerId}. Who is who: ${OBSERVER_KEY}.`,
    `Current world state (shared across all observers, authoritative for container contents):`,
    worldState,
    `Picture of each place (one node per physical object; a ghost was taken):`,
    sceneText || "- none drawn yet",
    `Most recent change anywhere: ${latestChange(containers)}`,
    `Usage trends over the last 14 days (pace, time left, what to buy, freshness guesses):`,
    formatTrends(trends, (date) => date.toLocaleString("en-GB")),
    `Memories and events (most relevant first):`,
    memories.length
      ? memories
          .map((m) => `- [${m.when}, observer ${m.observerId ?? "?"}, ${m.type}] ${m.text}`)
          .join("\n")
      : "- none yet",
    `Long-term memory (shared graph, across sessions):`,
    longTerm?.text ?? "- none",
    offers.length
      ? `Live web listings (Bright Data) for what to buy:\n${offers.map((offer) => `- ${offer.title} — ${offer.snippet} (${offer.url})`).join("\n")}`
      : "Live web listings: none",
    `Utterance: "${text}"`,
  ].join("\n");

  // Stored-state questions can be answered by TrueForge on OpenAI. The graph
  // context is in the turn. Anything it cannot answer falls through below.
  if (hasAnswerAgent() && !fastAnswers() && isStoredStateQuestion(text)) {
    const agent = await askAnswerAgent(text, observerId, context);
    if (!agent) log("ask", "agent did not answer, using in-app path", { observer: observerId, text });
    if (agent) {
      log("ask", "answered", { observer: observerId, text, via: "trueforge", answer: agent.answer, ms: agent.latencyMs });
      await insertEvent({ type: "voice", observerId, title: "Voice", message: text, intent: "neutral" });
      await insertEvent({
        type: "answer",
        observerId,
        title: "Answer",
        message: agent.answer,
        summary: `Q: ${text} A: ${agent.answer}`,
        metadata: { question: text, latencyMs: agent.latencyMs },
      });
      void recordTurn({ observerId, role: "user", content: text });
      void recordTurn({ observerId, role: "assistant", content: agent.answer, modelName: "trueforge" });
      return Response.json({
        intent: "question",
        answer: agent.answer,
        anchor: null,
        via: "trueforge",
        scene: await lightPicture(text, pictures),
        latencyMs: Math.round(performance.now() - started),
      });
    }
  }

  const result = await generateJson<Decision>({
    system: SYSTEM,
    // Reasoning off misreads "no longer in the fridge" events as presence.
    reasoning: "low",
    parts: [
      ...(image
        ? [{ inline_data: { mime_type: "image/jpeg", data: image } }]
        : []),
      ...places.flatMap((place, index) => [
        { text: `REGISTERED PLACE ${index + 1}: "${place.name}"${place.place ? ` (${place.place})` : ""}. Reference photo, taken earlier:` },
        { inline_data: { mime_type: "image/jpeg", data: place.image.replace(/^data:image\/\w+;base64,/, "") } },
      ]),
      {
        text: context,
      },
    ],
  });

  const decision = result.data;
  const latencyMs = Math.round(performance.now() - started);

  if (decision.intent === "ignore") {
    await openPrivacyWindow(observerId);
    await insertEvent({
      type: "privacy",
      observerId,
      title: "Privacy request",
      message: "Utterance not recorded. Camera memory paused for 5 minutes.",
      summary: "Privacy request (content withheld)",
    });
  } else {
    await insertEvent({
      type: "voice",
      observerId,
      title: "Voice",
      message: text,
      intent: decision.intent === "remember" ? "remember" : "neutral",
    });
    const anchor = decision.anchor?.trim().toLowerCase().slice(0, 40) || undefined;
    // Short-term memory for this observer's session; the platform distills it
    // into episodic and semantic records in the background.
    void recordTurn({ observerId, role: "user", content: text });
    if (decision.intent === "remember" && image && anchor) {
      const registration = await perceiveEpisode({
        observerId,
        trigger: "register",
        frames: [{ image, at: Date.now(), phase: "during" }],
        container: anchor,
        anchorName: anchor,
        register: anchor,
      }).catch(() => null);
      log("ask", "registration", {
        observer: observerId,
        anchor,
        site: registration?.container,
        identity: registration?.identity,
        skipped: registration?.skipped,
        failed: registration === null,
      });
      if (registration?.skipped === "unsure") {
        decision.answer =
          "I couldn't tell whether that's already registered. Try again with the whole front in view.";
      } else if (registration?.container) {
        decision.answer =
          registration.identity === "known"
            ? `That's already registered as the ${registration.container}.`
            : `Registered as the ${registration.container}. I'll recognise it from now on.`;
      }
    }
    if (decision.intent === "remember" && decision.memory) {
      void rememberFact({
        label: anchor ?? decision.memory.slice(0, 60),
        text: decision.memory,
        observerId,
        metadata: anchor ? { anchor } : undefined,
      });
      await insertEvent({
        type: "memory",
        observerId,
        title: "Memory saved",
        message: decision.memory,
        // The dashboard holding the capture lease sees this on the event
        // stream and embeds reference views of the observer's feed into a
        // visual anchor, so later sightings of the same place start capture.
        metadata: anchor ? { object: anchor, detail: "anchor-request" } : undefined,
      });
    } else if (decision.intent === "remember" && anchor) {
      // No fact to store (the place was already known), but the dashboard
      // must still capture views of it: without a visual anchor nothing
      // starts a capture when someone else points a camera at the place.
      await insertEvent({
        type: "memory",
        observerId,
        title: "Place remembered",
        message: decision.answer,
        metadata: { object: anchor, detail: "anchor-request" },
      });
    } else {
      await insertEvent({
        type: "answer",
        observerId,
        title: "Answer",
        message: decision.answer,
        summary: `Q: ${text} A: ${decision.answer}`,
        metadata: { question: text, latencyMs },
      });
    }
    void recordTurn({ observerId, role: "assistant", content: decision.answer, modelName: result.model });
  }

  log("ask", "answered", {
    observer: observerId,
    text,
    via: "app",
    hasImage: Boolean(image),
    intent: decision.intent,
    anchor: decision.anchor ?? null,
    view: decision.view ?? null,
    matchedPlace: decision.matchedPlace ?? null,
    places: places.map((place) => place.name),
    sites: containers.map((site) => site.name),
    answer: decision.answer,
    model: result.model,
    ms: latencyMs,
  });

  return Response.json({
    intent: decision.intent,
    answer: decision.answer,
    memory: decision.memory,
    anchor: decision.anchor ?? null,
    view: image ? (decision.view ?? null) : null,
    matchedPlace: image ? (decision.matchedPlace ?? null) : null,
    retrieval: { mode, count: memories.length },
    longTerm: longTerm ? { tokens: longTerm.tokens, counts: longTerm.counts } : null,
    scene: decision.intent === "question" ? await lightPicture(text, pictures) : null,
    via: "app",
    model: result.model,
    tokens: result.usage,
    latencyMs,
  });
}

async function lightPicture(text: string, pictures: { key: string; name: string; scene: PlaceScene }[]) {
  const ranked = pictures
    .map((row) => ({ ...row, hit: highlightThings(row.scene, text) }))
    .filter((row) => row.hit.thingIds.length > 0)
    .sort((a, b) => b.hit.thingIds.length - a.hit.thingIds.length);
  const best = ranked[0];
  if (!best) return null;
  await saveHighlight(best.key, best.hit.thingIds, best.hit.path, text).catch((cause) => {
    log("ask", "highlight not saved", { error: errorText(cause) });
  });
  return { place: best.name, thingIds: best.hit.thingIds, path: best.hit.path };
}
