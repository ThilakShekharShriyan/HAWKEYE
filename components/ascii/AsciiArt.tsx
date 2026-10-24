"use client";

import { Ascii } from "ascii.rest/react";
import * as bootLog from "ascii.rest/pieces/boot-log";
import * as earth from "ascii.rest/pieces/earth";
import * as heartbeat from "ascii.rest/pieces/heartbeat";
import * as radar from "ascii.rest/pieces/radar";
import * as torusKnot from "ascii.rest/pieces/torus-knot";
import type { CSSProperties } from "react";

// Decorative animated ascii art (ascii.rest by @bas3line, MIT). The pieces are
// bundled here, so nothing loads over the network, and callers pass a name: a
// piece holds functions, which a server component could not hand to this one.
const PIECES = { radar, "boot-log": bootLog, earth, heartbeat, "torus-knot": torusKnot };

export type AsciiPieceName = keyof typeof PIECES;

/** One ink, sized by font size: a piece is a fixed grid of characters, so `size` sets its scale. */
export function AsciiArt({
  piece,
  size = 6,
  opacity = 0.55,
  fps,
  className = "",
  style,
}: {
  piece: AsciiPieceName;
  size?: number;
  opacity?: number;
  fps?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span aria-hidden className={`ascii-art inline-block ${className}`} style={{ fontSize: size, opacity, ...style }}>
      <Ascii piece={PIECES[piece]} mono options={fps ? { fps } : undefined} />
    </span>
  );
}
