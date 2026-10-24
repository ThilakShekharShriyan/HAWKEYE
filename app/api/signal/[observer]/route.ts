import {
  isObserverId,
  phoneAnswer,
  phoneLeave,
  phonePoll,
  viewerOffer,
  viewerPoll,
} from "@/lib/signal-store";

type SignalBody =
  | {
      kind: "offer";
      viewer: string;
      offerId: string;
      phoneSession: string;
      sdp: string;
    }
  | {
      kind: "answer";
      session: string;
      viewer: string;
      offerId: string;
      sdp: string;
    };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SDP_CHARS = 16 * 1024;

const validId = (value: unknown): value is string =>
  typeof value === "string" && ID_PATTERN.test(value);

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const session = params.get("session");
  const viewer = params.get("viewer");

  if (session) {
    if (!validId(session)) return Response.json({ error: "bad session" }, { status: 400 });
    return Response.json(phonePoll(observer, session), noStore);
  }
  if (viewer) {
    if (!validId(viewer)) return Response.json({ error: "bad viewer" }, { status: 400 });
    return Response.json(viewerPoll(observer, viewer), noStore);
  }
  return Response.json({ error: "missing session or viewer" }, { status: 400 });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as SignalBody | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const valid =
    typeof body.sdp === "string" &&
    body.sdp.length > 0 &&
    body.sdp.length <= MAX_SDP_CHARS &&
    validId(body.viewer) &&
    validId(body.offerId) &&
    (body.kind === "offer"
      ? validId(body.phoneSession)
      : body.kind === "answer" && validId(body.session));
  if (!valid) return Response.json({ error: "invalid signal" }, { status: 400 });
  const ok =
    body.kind === "offer"
      ? viewerOffer(observer, {
          viewer: body.viewer,
          offerId: body.offerId,
          phoneSession: body.phoneSession,
          offer: body.sdp,
        })
      : phoneAnswer(observer, body.session, body.viewer, body.offerId, body.sdp);

  return Response.json({ ok }, { status: ok ? 200 : 409 });
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/signal/[observer]">,
) {
  const { observer } = await ctx.params;
  const session = new URL(request.url).searchParams.get("session");
  if (isObserverId(observer) && session) phoneLeave(observer, session);
  return Response.json({ ok: true });
}
