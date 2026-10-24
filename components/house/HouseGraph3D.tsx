"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HouseGraph, HouseGroup, HouseLink, HouseNode } from "@/lib/house-graph";
import { AsciiArt } from "@/components/ascii/AsciiArt";

// The house in 3D, drawn with vasturiano's 3d-force-graph. Roommates, areas,
// sites and items are nodes; the links are the relationships between them.

const COLOR: Record<HouseGroup, string> = {
  house: "#0d1117",
  person: "#2f6fdb",
  area: "#c48a12",
  site: "#14946a",
  item: "#d9534f",
  duty: "#7c5cc4",
  observer: "#6b7280",
};

const TITLE: Record<HouseGroup, string> = {
  house: "House",
  person: "Roommate",
  area: "Area",
  site: "Site",
  item: "Item",
  duty: "Responsibility",
  observer: "Phone",
};

const SIZE: Record<HouseGroup, number> = { house: 14, person: 12, area: 9, site: 6, item: 3, duty: 5, observer: 3 };
const TEXT: Record<HouseGroup, number> = { house: 11, person: 10, area: 9, site: 7, item: 5.5, duty: 6, observer: 4.5 };
const DISTANCE: Record<string, number> = { LIVES_IN: 90, HAS_AREA: 80, HAS_SITE: 55, HOLDS: 32, RESPONSIBLE_FOR: 70, COVERS: 60, CARRIES: 35, ROOMMATE_OF: 70 };
const LINK_COLOR: Record<string, string> = {
  ROOMMATE_OF: "#2f6fdb",
  RESPONSIBLE_FOR: "#7c5cc4",
  COVERS: "#7c5cc4",
  HOLDS: "#d9534f",
};
const POLL_MS = 5000;

type GraphNode = HouseNode & { x?: number; y?: number; z?: number };
type GraphLink = Omit<HouseLink, "source" | "target"> & { source: string | GraphNode; target: string | GraphNode };

const endId = (end: string | GraphNode) => (typeof end === "string" ? end : end.id);
const pretty = (label: string) => label.replace(/\b\w/g, (letter) => letter.toUpperCase());

export function HouseGraph3D() {
  const mount = useRef<HTMLDivElement>(null);
  const graphRef = useRef<{ graphData: (data: unknown) => unknown; zoomToFit: (ms?: number, padding?: number) => unknown } | null>(null);
  const fitted = useRef(false);
  // Frame the whole house whenever the layout settles, until someone picks a node.
  const autoFit = useRef(true);
  const lastJson = useRef("");
  const [data, setData] = useState<HouseGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Load the graph, then keep it fresh so camera updates show up. One request
  // at a time (a slow reply is never overtaken by a newer one), sent with the
  // last ETag so an unchanged house costs a 304, and paused while the tab is hidden.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let started = 0;
    let applied = 0;
    let etag = "";
    async function load() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const mine = ++started;
      try {
        const response = await fetch("/api/house", { cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
        if (response.status === 304) {
          if (!stopped) setError(null);
          return;
        }
        if (!response.ok) throw new Error(`status ${response.status}`);
        const next = (await response.json()) as HouseGraph;
        if (stopped || mine < applied) return;
        applied = mine;
        etag = response.headers.get("etag") ?? "";
        const json = JSON.stringify(next);
        if (json !== lastJson.current) {
          lastJson.current = json;
          setData(next);
        }
        setError(null);
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "failed to load");
      } finally {
        inFlight = false;
      }
    }
    void load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Build the 3D scene once.
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    let cancelled = false;
    let teardown = () => {};
    setSceneError(null);
    fitted.current = false;
    autoFit.current = true;
    (async () => {
      const [{ default: ForceGraph3D }, { default: SpriteText }] = await Promise.all([
        import("3d-force-graph"),
        import("three-spritetext"),
      ]);
      if (cancelled) return;
      const graph = new ForceGraph3D(element)
        .backgroundColor("#f6f7f9")
        .nodeRelSize(4.5)
        .warmupTicks(80)
        .cooldownTime(4000)
        .nodeVal((node) => SIZE[(node as GraphNode).group])
        .nodeColor((node) => COLOR[(node as GraphNode).group])
        .nodeOpacity(0.92)
        .nodeLabel((node) => {
          const n = node as GraphNode;
          return `${TITLE[n.group]}: ${pretty(n.label)}${n.count ? ` × ${n.count}` : ""}`;
        })
        .nodeThreeObject((node) => {
          const n = node as GraphNode;
          const sprite = new SpriteText(pretty(n.label) + (n.group === "item" && n.count ? ` ×${n.count}` : ""));
          sprite.color = COLOR[n.group];
          sprite.textHeight = TEXT[n.group];
          sprite.position.y = SIZE[n.group] * 0.9 + 4;
          return sprite;
        })
        .nodeThreeObjectExtend(true)
        .linkColor((link) => LINK_COLOR[(link as GraphLink).type] ?? "#aab1bc")
        .linkOpacity(0.6)
        .linkWidth((link) => ((link as GraphLink).type === "ROOMMATE_OF" ? 2.5 : 0.6))
        .linkCurvature((link) => ((link as GraphLink).type === "ROOMMATE_OF" ? 0.35 : 0))
        .linkDirectionalArrowLength(3.5)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles((link) => ((link as GraphLink).type === "HOLDS" ? 2 : 0))
        .linkDirectionalParticleWidth(1.4)
        .linkLabel((link) => {
          const l = link as GraphLink;
          return `${l.type.toLowerCase().replace(/_/g, " ")}${l.count ? ` × ${l.count}` : ""}`;
        })
        .onNodeClick((node: object) => {
          const n = node as GraphNode;
          autoFit.current = false;
          setPicked(n.id);
          const at = { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 };
          const ratio = 1 + 90 / (Math.hypot(at.x, at.y, at.z) || 1);
          graph.cameraPosition({ x: at.x * ratio, y: at.y * ratio, z: at.z * ratio }, at, 900);
        })
        .onEngineStop(() => {
          if (autoFit.current) graph.zoomToFit(600, 40);
        })
        .onBackgroundClick(() => setPicked(null));
      // Spread the layout: stronger repulsion and link lengths by relationship.
      graph.d3Force("charge")?.strength(-260);
      graph.d3Force("link")?.distance((link: object) => DISTANCE[(link as GraphLink).type] ?? 50);
      graphRef.current = graph as unknown as typeof graphRef.current;

      const fit = () => graph.width(element.clientWidth).height(element.clientHeight);
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(element);
      // Whoever orbits, pans or zooms has chosen their view: stop re-framing it when the layout settles.
      const takeOver = () => {
        autoFit.current = false;
      };
      const touches = ["pointerdown", "wheel", "touchstart"] as const;
      for (const type of touches) element.addEventListener(type, takeOver, { passive: true });
      teardown = () => {
        for (const type of touches) element.removeEventListener(type, takeOver);
        observer.disconnect();
        graph.pauseAnimation();
        graph._destructor();
      };
    })().catch((cause) => {
      // A chunk that fails to load (or WebGL that cannot start) must say so, not leave a blank canvas.
      if (!cancelled) setSceneError(cause instanceof Error ? cause.message : "the 3D view failed to start");
    });
    return () => {
      cancelled = true;
      teardown();
      graphRef.current = null;
    };
  }, [attempt]);

  // Feed new data into the scene. Copies, because the library mutates what it is given.
  useEffect(() => {
    if (!data) return;
    const apply = () => {
      if (!graphRef.current) return false;
      graphRef.current.graphData({
        nodes: data.nodes.map((node) => ({ ...node })),
        links: data.links.map((link) => ({ ...link })),
      });
      if (!fitted.current) {
        // Positions are settled by the warm-up, so frame the whole house once.
        fitted.current = true;
        setTimeout(() => graphRef.current?.zoomToFit(0, 30), 80);
      }
      return true;
    };
    if (apply()) return;
    const retry = setInterval(() => apply() && clearInterval(retry), 150);
    return () => clearInterval(retry);
  }, [data]);

  const counts = useMemo(() => {
    const out = new Map<HouseGroup, number>();
    for (const node of data?.nodes ?? []) out.set(node.group, (out.get(node.group) ?? 0) + 1);
    return out;
  }, [data]);

  const detail = useMemo(() => {
    if (!data || !picked) return null;
    const node = data.nodes.find((candidate) => candidate.id === picked);
    if (!node) return null;
    const label = (id: string) => pretty(data.nodes.find((candidate) => candidate.id === id)?.label ?? id);
    const rel = (link: HouseLink) => link.type.toLowerCase().replace(/_/g, " ");
    const out = data.links
      .filter((link) => endId(link.source) === picked)
      .map((link) => `${rel(link)} → ${label(endId(link.target))}${link.count ? ` × ${link.count}` : ""}`);
    const incoming = data.links
      .filter((link) => endId(link.target) === picked)
      .map((link) => `${label(endId(link.source))} → ${rel(link)}${link.count ? ` × ${link.count}` : ""}`);
    return { node, out, incoming };
  }, [data, picked]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-paper text-ink">
      <div ref={mount} className="absolute inset-0" />

      <header className="pointer-events-none absolute left-5 top-4 z-10">
        <h1 className="text-lg font-semibold tracking-wide text-ink">HAWKEYE · House</h1>
        <p className="text-xs text-ink/60">
          Roommates, the areas and sites they share, and what is in them. Drag to orbit, scroll to zoom, click a node.
        </p>
        {error ? <p className="mt-1 text-xs text-red-400">Could not load the graph: {error}</p> : null}
        {sceneError ? (
          <p className="pointer-events-auto mt-1 text-xs text-red-400">
            The 3D view could not start: {sceneError}{" "}
            <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </p>
        ) : null}
        {data && data.nodes.length === 0 ? (
          <p className="mt-1 text-xs text-amber-700">The graph is empty. Run npm run seed:demo.</p>
        ) : null}
      </header>

      {!data && !error ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-hidden">
          <div className="scan-line" />
          <AsciiArt piece="torus-knot" size={7} opacity={0.6} />
          <p className="font-mono text-[11px] tracking-[0.2em] text-ink/50">LOADING THE HOUSE GRAPH</p>
        </div>
      ) : null}

      <aside className="absolute bottom-4 left-5 z-10 rounded-md border border-ink/10 bg-panel/80 p-3 text-xs backdrop-blur">
        {(Object.keys(COLOR) as HouseGroup[]).map((group) => (
          <div key={group} className="flex items-center gap-2 py-0.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[group] }} />
            <span>{TITLE[group]}</span>
            <span className="ml-auto pl-4 text-ink/45">{counts.get(group) ?? 0}</span>
          </div>
        ))}
      </aside>

      {detail ? (
        <aside className="absolute right-5 top-4 z-10 w-72 rounded-md border border-ink/10 bg-panel/90 p-3 text-xs backdrop-blur">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[detail.node.group] }} />
            <span className="text-sm font-medium text-ink">{pretty(detail.node.label)}</span>
            <span className="ml-auto text-ink/45">{TITLE[detail.node.group]}</span>
          </div>
          {detail.node.count ? <p className="mb-1 text-ink/60">{detail.node.count} in the house</p> : null}
          {[...detail.out, ...detail.incoming].length === 0 ? <p className="text-ink/45">No relationships.</p> : null}
          <ul className="max-h-72 space-y-0.5 overflow-auto text-ink/75">
            {detail.out.map((line) => (
              <li key={`o-${line}`}>{line}</li>
            ))}
            {detail.incoming.map((line) => (
              <li key={`i-${line}`} className="text-ink/60">
                {line}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </main>
  );
}
