import { describe, expect, it } from "vitest";
import { checkAccess, safeEqual } from "../lib/access";

describe("access gate", () => {
  it("accepts only the exact token", () => {
    expect(checkAccess("secret", "secret", true)).toBe("ok");
    expect(checkAccess("secre", "secret", true)).toBe("denied");
    expect(checkAccess("secrets", "secret", true)).toBe("denied");
    expect(checkAccess(null, "secret", true)).toBe("denied");
    expect(checkAccess("", "secret", false)).toBe("denied");
  });

  it("fails closed in production without a token, open in development", () => {
    expect(checkAccess("anything", undefined, true)).toBe("unconfigured");
    expect(checkAccess(null, undefined, false)).toBe("ok");
  });

  it("compares in constant time over equal and unequal lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
