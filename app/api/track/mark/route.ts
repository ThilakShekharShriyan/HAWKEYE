import { insertEvent } from "@/lib/events-repo";
import { isObserverId } from "@/lib/signal-store";

// Someone clicked a tracked object on the dashboard to mark (or unmark) it.
// The mark becomes an event, so it shows in the feed and in memory.

type MarkBody = { observerId?: string; label?: string; id?: number; marked?: boolean };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as MarkBody;
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  const label = typeof body.label === "string" ? body.label.trim().toLowerCase().slice(0, 40) : "";
  if (!label || !Number.isInteger(body.id)) return Response.json({ error: "label and id required" }, { status: 400 });
  const marked = body.marked !== false;
  const name = `${label} #${body.id}`;
  await insertEvent({
    type: "observation",
    observerId: body.observerId,
    title: marked ? `Marked ${name}` : `Unmarked ${name}`,
    message: marked ? `Observer ${body.observerId} is tracking this ${label}` : `Observer ${body.observerId} stopped tracking this ${label}`,
    metadata: { object: label, detail: `track #${body.id}` },
    summary: `Observer ${body.observerId} ${marked ? "marked" : "unmarked"} the ${label} (track #${body.id}) for tracking.`,
  });
  return Response.json({ ok: true });
}
