"use client";

import { useState } from "react";
import { cameraLabel } from "@/lib/observers";

export type SceneThing = {
  id: string;
  label: string;
  kind: string;
  context: string;
  restock: string | null;
  slot: string;
  state: "live" | "ghost";
  lastSeenBy: string | null;
  takenBy: string | null;
  takenAt: number | null;
  path: string;
};

export type PlaceSceneData = {
  shape: "surface" | "shelves";
  slots: { name: string; things: SceneThing[] }[];
  ghosts: SceneThing[];
  highlight: { thingIds: string[]; path: string; question: string } | null;
};

const surfaceAt: Record<string, [number, number]> = {
  left: [28, 58],
  center: [50, 62],
  right: [72, 58],
};

const shelfAt: Record<string, [number, number]> = {
  top: [50, 24],
  middle: [50, 44],
  bottom: [50, 64],
  door: [78, 44],
};

function Mark({
  thing,
  x,
  y,
  lit,
  onPick,
}: {
  thing: SceneThing;
  x: number;
  y: number;
  lit: boolean;
  onPick: (thing: SceneThing) => void;
}) {
  const ghost = thing.state === "ghost";
  return (
    <g className="cursor-pointer" onClick={() => onPick(thing)}>
      <circle
        cx={x}
        cy={y}
        r={lit ? 8 : 6.5}
        fill={ghost ? "transparent" : "rgba(13,17,23,0.14)"}
        stroke={lit ? "#0d1117" : ghost ? "rgba(13,17,23,0.35)" : "rgba(13,17,23,0.7)"}
        strokeWidth={lit ? 1.6 : 1}
        strokeDasharray={ghost ? "2 1.5" : undefined}
      />
      <text x={x} y={y + 14} textAnchor="middle" fill="rgba(13,17,23,0.75)" fontSize="3.2">
        {thing.kind}
      </text>
    </g>
  );
}

export function PlaceScene({ scene }: { scene: PlaceSceneData }) {
  const [picked, setPicked] = useState<string | null>(null);
  const lit = new Set(picked ? [picked] : (scene.highlight?.thingIds ?? []));
  const things = [...scene.slots.flatMap((slot) => slot.things), ...scene.ghosts];
  const chosen = things.find((thing) => thing.id === picked) ?? null;
  const path = chosen?.path || scene.highlight?.path || "";
  const kinds = new Map<string, SceneThing>();
  for (const thing of things) kinds.set(thing.kind, thing);
  const at = scene.shape === "shelves" ? shelfAt : surfaceAt;

  return (
    <div>
      <svg viewBox="0 0 100 88" className="h-64 w-full max-w-md" role="img" aria-label="Picture of this place">
        {scene.shape === "shelves" ? (
          <g>
            <rect x="16" y="8" width="68" height="74" rx="2" fill="rgba(13,17,23,0.03)" stroke="rgba(13,17,23,0.28)" />
            <line x1="16" y1="34" x2="70" y2="34" stroke="rgba(13,17,23,0.18)" />
            <line x1="16" y1="54" x2="70" y2="54" stroke="rgba(13,17,23,0.18)" />
            <line x1="70" y1="8" x2="70" y2="82" stroke="rgba(13,17,23,0.18)" />
          </g>
        ) : (
          <ellipse cx="50" cy="58" rx="40" ry="18" fill="rgba(13,17,23,0.04)" stroke="rgba(13,17,23,0.28)" />
        )}
        {scene.slots.flatMap((slot) =>
          slot.things.map((thing, index) => {
            const spot = at[slot.name] ?? [50, 50];
            return (
              <Mark
                key={thing.id}
                thing={thing}
                x={spot[0] + index * 8}
                y={spot[1]}
                lit={lit.has(thing.id)}
                onPick={(next) => setPicked(next.id)}
              />
            );
          }),
        )}
        {scene.ghosts.map((thing, index) => {
          const spot = at[thing.slot] ?? [50, 50];
          return (
            <Mark
              key={thing.id}
              thing={thing}
              x={spot[0]}
              y={spot[1] - 10 - index * 4}
              lit={lit.has(thing.id)}
              onPick={(next) => setPicked(next.id)}
            />
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-col gap-1">
        {things.length === 0 ? <li className="text-[13px] text-ink/40">Nothing placed on the picture yet.</li> : null}
        {things.map((thing) => (
          <li key={thing.id}>
            <button type="button" onClick={() => setPicked(thing.id)} className="text-left text-[12px] text-ink/70">
              <span className={thing.state === "ghost" ? "text-ink/40" : "text-ink/85"}>{thing.label}</span>
              {thing.state === "ghost"
                ? ` · taken${thing.takenBy ? ` · ${cameraLabel(thing.takenBy)}` : ""}`
                : thing.lastSeenBy
                  ? ` · last seen by ${cameraLabel(thing.lastSeenBy)}`
                  : ""}
            </button>
          </li>
        ))}
      </ul>
      {[...kinds.values()].map((thing) => (
        <p key={thing.kind} className="mt-2 text-[12px] text-ink/45">
          {thing.kind} is {thing.context}
          {thing.restock ? `, restocked from the ${thing.restock}` : ""}.
        </p>
      ))}
      {path ? <p className="mt-3 font-mono text-[11px] leading-5 text-ink/55">{path}</p> : null}
      {scene.highlight?.question && !picked ? (
        <p className="mt-1 text-[11px] text-ink/35">From “{scene.highlight.question}”</p>
      ) : null}
    </div>
  );
}
