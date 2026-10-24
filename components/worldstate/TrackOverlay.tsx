"use client";

import type { LiveObject } from "@/lib/tracker";

const MARKED = "#c6a56a";
const PERSON = "#7dd3fc";
const THING = "#a7f3d0";

export const trackKey = (object: Pick<LiveObject, "label" | "id">) => `${object.label}#${object.id}`;

/**
 * Boxes, labels, IDs and trails for what the tracker follows. Drawn in video
 * pixels with the same fit as the video, so boxes stay on their objects.
 * Clicking a box marks that object (and clicking again unmarks it).
 */
export function TrackOverlay({
  objects,
  frameSize,
  marked,
  onToggle,
}: {
  objects: LiveObject[];
  frameSize: { width: number; height: number };
  marked: ReadonlySet<string>;
  onToggle: (object: LiveObject, nowMarked: boolean) => void;
}) {
  const { width: W, height: H } = frameSize;
  const font = Math.max(11, H / 34);
  return (
    <svg
      aria-label="Tracked objects"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {objects.map((object) => {
        const key = trackKey(object);
        const isMarked = marked.has(key);
        const color = isMarked ? MARKED : object.label === "person" ? PERSON : THING;
        const [x1, y1, x2, y2] = object.box;
        const x = x1 * W;
        const y = y1 * H;
        const w = Math.max(2, (x2 - x1) * W);
        const h = Math.max(2, (y2 - y1) * H);
        const text = `${isMarked ? "★ " : ""}${object.label} #${object.id} ${Math.round(object.confidence * 100)}%`;
        const labelW = text.length * font * 0.58 + font * 0.8;
        const labelY = y - font * 1.5 >= 0 ? y - font * 1.5 : y + h;
        const points = object.trail.map(([cx, cy]) => `${cx * W},${cy * H}`).join(" ");
        return (
          <g key={key}>
            {object.trail.length > 1 ? (
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeOpacity={0.7}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <g
              role="button"
              aria-label={`${object.label} ${object.id}, ${isMarked ? "marked" : "click to mark"}`}
              aria-pressed={isMarked}
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onClick={() => onToggle(object, !isMarked)}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={isMarked ? "rgba(198,165,106,0.12)" : "transparent"}
                stroke={color}
                strokeWidth={isMarked ? 3 : 2}
                vectorEffect="non-scaling-stroke"
              />
              <rect x={x} y={labelY} width={labelW} height={font * 1.4} fill="rgba(0,0,0,0.68)" />
              <text
                x={x + font * 0.4}
                y={labelY + font * 1.05}
                fill={color}
                fontSize={font}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {text}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
