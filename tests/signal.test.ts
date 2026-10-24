import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/signal/[observer]/route";
import { phonePoll, viewerOffer, viewerPoll } from "@/lib/signal-store";

const ctx = (observer: string) => ({ params: Promise.resolve({ observer }) }) as never;
const post = (body: unknown, raw?: string) =>
  POST(
    new Request("http://x/api/signal/01", { method: "POST", body: raw ?? JSON.stringify(body) }),
    ctx("01"),
  );

describe("signal store limits", () => {
  it("keeps at most 8 viewers per observer, evicting the oldest", () => {
    phonePoll("02", "phone-1");
    for (let i = 0; i < 12; i += 1) {
      viewerOffer("02", { viewer: `v${i}`, offerId: `o${i}`, phoneSession: "phone-1", offer: "sdp" });
    }
    expect(phonePoll("02", "phone-1").offers).toHaveLength(8);
    expect(viewerPoll("02", "v0").offerId).toBeUndefined();
    expect(viewerPoll("02", "v11").offerId).toBe("o11");
  });
});

describe("signal route validation", () => {
  it("rejects bad json with 400", async () => {
    expect((await post(null, "{nope")).status).toBe(400);
  });
  it("rejects oversized sdp and odd ids", async () => {
    const base = { kind: "offer", viewer: "v1", offerId: "o1", phoneSession: "p1" };
    expect((await post({ ...base, sdp: "x".repeat(17 * 1024) })).status).toBe(400);
    expect((await post({ ...base, viewer: "bad id!", sdp: "x" })).status).toBe(400);
  });
});
