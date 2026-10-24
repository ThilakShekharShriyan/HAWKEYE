import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const req = (path: string, init: { cookie?: string; header?: string } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: {
      ...(init.cookie ? { cookie: `hawkeye_token=${init.cookie}` } : {}),
      ...(init.header ? { "x-hawkeye-token": init.header } : {}),
    },
  });

describe("proxy access gate", () => {
  beforeEach(() => {
    process.env.HAWKEYE_ACCESS_TOKEN = "new-token";
  });
  afterEach(() => {
    delete process.env.HAWKEYE_ACCESS_TOKEN;
  });

  it("blocks api and pages without a token", () => {
    expect(proxy(req("/api/places")).status).toBe(401);
    expect(proxy(req("/")).status).toBe(401);
  });

  it("accepts the header or the cookie", () => {
    expect(proxy(req("/api/places", { header: "new-token" })).status).toBe(200);
    expect(proxy(req("/api/places", { cookie: "new-token" })).status).toBe(200);
  });

  it("lets a valid link replace a stale cookie", () => {
    const res = proxy(req("/?token=new-token", { cookie: "old-token" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(res.cookies.get("hawkeye_token")?.value).toBe("new-token");
  });

  it("does not let a mistyped link overwrite a good cookie", () => {
    const res = proxy(req("/?token=nope", { cookie: "new-token" }));
    expect(res.status).toBe(401);
    expect(res.cookies.get("hawkeye_token")).toBeUndefined();
  });
});
