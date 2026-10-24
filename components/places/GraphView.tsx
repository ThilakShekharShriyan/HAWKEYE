"use client";

import { useMemo, useState } from "react";
import type { GraphGroup, WorldGraph } from "@/lib/world-graph";

const ORDER: GraphGroup[] = ["observer", "event", "thing", "slot", "place", "kind"];

const TITLE: Record<GraphGroup, string> = {
  observer: "Observer",
  event: "Event",
  thing: "Thing",
  slot: "Slot",
  place: "Place",
  kind: "Kind",
};

const FILL: Record<GraphGroup, string> = {
  observer: "#8eb6ff",
  event: "#d7b4ff",
  thing: "#f4f4f4",
  slot: "#9aa3ad",
  place: "#7dcea0",
  kind: "#f0c36a",
};

const COL_W = 210;
const ROW_H = 72;
const NODE_W = 158;
const NODE_H = 36;
const PAD_X = 24;
const PAD_Y = 36;

function short(label: string, max = 26) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Node-link drawing of the mesh: each place is its own node, edges are the relations. */
export function GraphView({ graph, focus }: { graph: WorldGraph; focus: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    let rows = 1;
    ORDER.forEach((group, col) => {
      const column = graph.nodes
        .filter((node) => node.group === group)
        .sort((a, b) => Number(b.place === focus) - Number(a.place === focus) || a.label.localeCompare(b.label));
      rows = Math.max(rows, column.length);
      column.forEach((node, row) => {
        pos.set(node.id, { x: PAD_X + col * COL_W, y: PAD_Y + row * ROW_H });
      });
    });
    return {
      pos,
      width: PAD_X + ORDER.length * COL_W,
      height: PAD_Y + rows * ROW_H + 12,
    };
  }, [graph, focus]);

  const focusIds = useMemo(() => {
    const ids = new Set(
      graph.nodes
        .filter(
          (node) =>
            node.place === focus || (node.group === "place" && (node.label === focus || node.label.startsWith(`${focus} —`))),
        )
        .map((node) => node.id),
    );
    if (!focus) return ids;
    const scene = new Set(["HOLDS", "HAS_SLOT", "IN", "KIND", "TOOK", "WAS_IN", "LAST_SEEN_BY", "RESTOCK_FROM", "WATCHES", "ABOUT"]);
    for (let hop = 0; hop < 2; hop++) {
      for (const edge of graph.edges) {
        if (!scene.has(edge.type)) continue;
        if (ids.has(edge.from)) ids.add(edge.to);
        else if (ids.has(edge.to)) ids.add(edge.from);
      }
    }
    return ids;
  }, [graph, focus]);

  if (graph.nodes.length === 0) {
    return <p className="text-[13px] text-white/40">No nodes yet. Remember a place and it shows up here as its own node.</p>;
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const pickedNode = picked ? byId.get(picked) : undefined;
  const lines = graph.edges
    .filter((edge) => !picked || edge.from === picked || edge.to === picked)
    .slice(0, 12)
    .map((edge) => {
      const from = byId.get(edge.from)?.label ?? edge.from;
      const to = byId.get(edge.to)?.label ?? edge.to;
      return `${short(from, 32)} —${edge.type}→ ${short(to, 32)}`;
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        {ORDER.map((group) => (
          <span key={group} className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-white/45 uppercase">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: FILL[group] }} />
            {TITLE[group]}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-md border border-white/[0.08] bg-black/30">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          className="block max-w-none"
          role="img"
          aria-label={focus ? `Graph focused on ${focus}` : "Graph of places, things, and relations"}
        >
          {ORDER.map((group, col) => (
            <text
              key={group}
              x={PAD_X + col * COL_W}
              y={16}
              fill="rgba(255,255,255,0.35)"
              fontSize={10}
              fontFamily="ui-monospace, monospace"
            >
              {TITLE[group].toUpperCase()}
            </text>
          ))}
          {graph.edges.map((edge) => {
            const from = layout.pos.get(edge.from);
            const to = layout.pos.get(edge.to);
            if (!from || !to) return null;
            const lit = !focus || focusIds.has(edge.from) || focusIds.has(edge.to);
            const hot = picked === edge.from || picked === edge.to;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2 - 16;
            return (
              <g key={edge.id} opacity={lit ? 0.95 : 0.15}>
                <path
                  d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                  fill="none"
                  stroke={hot ? "#ffffff" : "rgba(255,255,255,0.38)"}
                  strokeWidth={hot ? 1.6 : 1}
                />
                {lit ? (
                  <text
                    x={midX}
                    y={midY}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.7)"
                    stroke="#0b0d11"
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={8}
                    fontFamily="ui-monospace, monospace"
                  >
                    {edge.type}
                  </text>
                ) : null}
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const at = layout.pos.get(node.id);
            if (!at) return null;
            const lit = !focus || focusIds.has(node.id);
            const hot = picked === node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${at.x} ${at.y})`}
                opacity={lit ? 1 : 0.28}
                onClick={() => setPicked((current) => (current === node.id ? null : node.id))}
                style={{ cursor: "pointer" }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill={hot ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.45)"}
                  stroke={FILL[node.group]}
                  strokeWidth={hot ? 2 : 1.25}
                  strokeDasharray={node.ghost ? "4 3" : undefined}
                />
                <text x={10} y={22} fill={FILL[node.group]} fontSize={11} fontFamily="ui-sans-serif, system-ui, sans-serif">
                  {short(node.label)}
                </text>
                <title>{node.label}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-[12px] text-white/55">
        {focus ? `This look is ${focus}. Other places stay on the graph, dimmed.` : "Every place is its own node."}
        {pickedNode ? ` Selected ${pickedNode.label}.` : ""}
      </p>
      {lines.length ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {lines.map((line) => (
            <li key={line} className="font-mono text-[10px] text-white/45">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
