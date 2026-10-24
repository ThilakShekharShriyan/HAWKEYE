import { describe, expect, it } from "vitest";
import {
  countsFromLayout,
  endMarks,
  highlightThings,
  kindContext,
  layoutFromCounts,
  mentionedSlot,
  normalizeSlot,
  parseLayout,
  placeShape,
  type PlaceScene,
} from "@/lib/scene";

const scene = (extra?: Partial<PlaceScene>): PlaceScene => ({
  shape: "surface",
  slots: [
    {
      name: "left",
      things: [],
    },
    {
      name: "center",
      things: [],
    },
    {
      name: "right",
      things: [
        {
          id: "right",
          label: "pepsi bottle (right)",
          kind: "pepsi bottle",
          context: "a drink",
          restock: "hall cooler",
          slot: "right",
          state: "live",
          lastSeenBy: "01",
          takenBy: null,
          takenAt: null,
          path: "pepsi bottle (right) -IN-> right -ON-> table",
        },
      ],
    },
  ],
  ghosts: [
    {
      id: "left",
      label: "pepsi bottle (left)",
      kind: "pepsi bottle",
      context: "a drink",
      restock: "hall cooler",
      slot: "left",
      state: "ghost",
      lastSeenBy: null,
      takenBy: "02",
      takenAt: 1,
      path: "Observer 02 -TOOK-> pepsi bottle (left) -WAS_IN-> table",
    },
  ],
  highlight: null,
  ...extra,
});

describe("place picture", () => {
  it("uses shelves for a fridge and a surface for a table", () => {
    expect(placeShape("fridge")).toBe("shelves");
    expect(placeShape("table")).toBe("surface");
    expect(normalizeSlot("upper shelf", "shelves")).toBe("top");
    expect(normalizeSlot("beside", "surface")).toBe("center");
  });

  it("parses one mark per object and counts only what is still there", () => {
    const marks = parseLayout(
      [
        { kind: "pepsi bottles", slot: "left", present: false },
        { kind: "pepsi bottle", slot: "right", present: true },
      ],
      "surface",
      ["pepsi bottle"],
    );
    expect(marks).toEqual([
      { kind: "pepsi bottle", slot: "left", present: false },
      { kind: "pepsi bottle", slot: "right", present: true },
    ]);
    expect(countsFromLayout(marks)).toEqual([{ name: "pepsi bottle", count: 1 }]);
  });

  it("spreads two counted objects to the ends of the surface", () => {
    expect(layoutFromCounts([{ name: "pepsi bottle", count: 2 }], "surface")).toEqual([
      { kind: "pepsi bottle", slot: "left", present: true },
      { kind: "pepsi bottle", slot: "right", present: true },
    ]);
  });

  it("keeps the rightmost bottle when a full look leaves only one", () => {
    expect(
      endMarks(
        [{ name: "pepsi bottle", count: 1 }],
        [
          { kind: "pepsi bottle", slot: "left", present: true },
          { kind: "pepsi bottle", slot: "right", present: true },
        ],
        "surface",
      ),
    ).toEqual([{ kind: "pepsi bottle", slot: "right", present: true }]);
  });

  it("shares drink context on the kind", () => {
    expect(kindContext("pepsi bottle").restock).toBe("hall cooler");
    expect(kindContext("laptop").restock).toBeNull();
  });

  it("does not treat 'are left' as the left slot", () => {
    expect(mentionedSlot("how many pepsis are left on the table")).toBeNull();
    expect(mentionedSlot("who took the left pepsi")).toBe("left");
  });

  it("lights the survivor for a count and the ghost for who took it", () => {
    expect(highlightThings(scene(), "how many pepsis are left on the table").thingIds).toEqual(["right"]);
    expect(highlightThings(scene(), "who took the left pepsi").thingIds).toEqual(["left"]);
  });
});
