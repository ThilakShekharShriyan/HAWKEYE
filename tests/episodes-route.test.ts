import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/episodes/route";
import { claimLease } from "@/lib/capture-lease";

claimLease("test-viewer");

const send = (frames: unknown[]) =>
  POST(
    new Request("http://x/api/episodes", {
      method: "POST",
      body: JSON.stringify({ observerId: "01", viewer: "test-viewer", frames }),
    }),
  );
const frame = (over: Record<string, unknown> = {}) => ({
  image: "aGVsbG8=",
  at: Date.now(),
  phase: "during",
  ...over,
});

describe("episode upload validation", () => {
  it("requires the capture lease holder as viewer", async () => {
    const post = (viewer?: string) =>
      POST(new Request("http://x/api/episodes", { method: "POST", body: JSON.stringify({ observerId: "01", viewer, frames: [frame()] }) }));
    expect((await post()).status).toBe(409);
    expect((await post("someone-else")).status).toBe(409);
  });
  it("rejects missing or absurd capture times", async () => {
    expect((await send([frame({ at: undefined })])).status).toBe(400);
    expect((await send([frame({ at: "now" })])).status).toBe(400);
    expect((await send([frame({ at: Date.now() - 3_600_000 })])).status).toBe(400);
    expect((await send([frame({ at: Date.now() + 3_600_000 })])).status).toBe(400);
  });
  it("rejects out-of-order frames and non-base64 images", async () => {
    const t = Date.now();
    expect((await send([frame({ at: t }), frame({ at: t - 1000 })])).status).toBe(400);
    expect((await send([frame({ image: "not base64 !!" })])).status).toBe(400);
  });
  it("rejects oversized frames", async () => {
    expect((await send([frame({ image: "A".repeat(2_100_000) })])).status).toBe(413);
  });
});
