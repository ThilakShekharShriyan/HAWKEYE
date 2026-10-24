import { describe, expect, it } from "vitest";
import { anchoredFirst, MAX_CANDIDATES, withAnchoredPlace } from "../lib/candidates";

const place = (name: string) => ({ name });
const newest = ["a", "b", "c", "d", "e", "f"].map(place);

describe("withAnchoredPlace", () => {
  it("keeps the six most recent places when nothing is anchored", () => {
    expect(withAnchoredPlace(newest, null)).toEqual(newest);
  });

  it("does not add a place that is already a candidate", () => {
    expect(withAnchoredPlace(newest, place("c"))).toEqual(newest);
  });

  it("gives an older anchored place a slot inside the limit, evicting the least recent candidate", () => {
    const result = withAnchoredPlace(newest, place("table"));
    expect(result).toHaveLength(MAX_CANDIDATES);
    expect(result.map((p) => p.name)).toEqual(["a", "b", "c", "d", "e", "table"]);
  });

  it("never returns more than six, so every candidate has an identity letter", () => {
    expect(withAnchoredPlace([...newest, place("g"), place("h")], place("table"))).toHaveLength(MAX_CANDIDATES);
  });
});

describe("anchoredFirst", () => {
  it("puts the anchored place first, matching despite casing and spacing", () => {
    const places = ["fridge", "dining table", "oven"].map(place);
    expect(anchoredFirst(places, "  Dining   TABLE ").map((p) => p.name)).toEqual(["dining table", "fridge", "oven"]);
  });

  it("leaves the order alone with no anchor or no match", () => {
    const places = ["fridge", "oven"].map(place);
    expect(anchoredFirst(places, undefined)).toEqual(places);
    expect(anchoredFirst(places, "garage")).toEqual(places);
  });
});
