"use client";

import { useEffect, useRef, useState } from "react";
import { SpatialBreadcrumb } from "@/components/worldstate/SpatialBreadcrumb";
import { SpeechOverlay } from "@/components/worldstate/SpeechOverlay";
import { TrackOverlay, trackKey } from "@/components/worldstate/TrackOverlay";
import { VoiceMirror } from "@/components/worldstate/VoiceMirror";
import type { Observer, VoiceSnapshot } from "@/lib/types";
import { clog } from "@/lib/client-log";
import type { LiveObject } from "@/lib/tracker";
import { useAnchorWatch, type AnchorWatch } from "@/lib/use-anchor-watch";
import { useLiveTracks, type PlaceHint } from "@/lib/use-live-tracks";

function WatchBadge({ watch, leader }: { watch: AnchorWatch; leader: boolean }) {
  const subject = watch.resolved ?? (watch.anchor?.active ? watch.anchor.name : (watch.site ?? "site"));
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const text =
    watch.phase === "loading"
      ? "Loading detector"
      : watch.phase === "error"
        ? "Detector unavailable"
        : watch.phase === "capturing"
          ? `${subject} · capturing · ${watch.captured}`
          : watch.phase === "sending"
            ? `${subject} · reading contents`
            : watch.anchor?.active
              ? `${watch.anchor.name} · ${pct(watch.anchor.similarity)}`
              : watch.box
                ? `${watch.box.site} · ${pct(watch.box.score)}`
                : watch.lastResult
                  ? `Last: ${watch.lastResult}`
                  : watch.anchors > 0
                    ? `Watching for fridges, tables + ${watch.anchors} saved site${watch.anchors === 1 ? "" : "s"}`
                    : "Watching for fridges and tables · say \u201cremember this\u201d to save a site";
  // Best candidate below threshold: shown dim so thresholds can be tuned live.
  const candidate =
    watch.anchor && !watch.anchor.active && watch.phase === "watching"
      ? `· ${watch.anchor.name} ${pct(watch.anchor.similarity)}`
      : null;
  const active = watch.phase === "capturing" || watch.phase === "sending" || Boolean(watch.anchor?.active);

  return (
    <p
      className={`mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase ${active ? "text-change" : "text-white/55"}`}
    >
      {watch.phase === "sending" || watch.phase === "loading" ? (
        <span className="spinner" aria-hidden />
      ) : active ? (
        <span className="live-dot" aria-hidden />
      ) : null}
      {text}
      {candidate ? <span className="text-white/30">{candidate}</span> : null}
      {!leader ? <span className="text-white/30">· view only</span> : null}
    </p>
  );
}

function SensorPlate({ id }: { id: Observer["id"] }) {
  const kitchen = id === "01";

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b0d11]">
      <div
        className={`plate-drift absolute -inset-[10%] ${kitchen ? "plate-kitchen" : "plate-bedroom"}`}
        style={{ animationDelay: kitchen ? "0s" : "-16s" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />
      <div className="sensor-grain absolute inset-0" />
    </div>
  );
}

export function CameraFeed({
  observer,
  stream,
  voice,
  capture,
  clock,
}: {
  observer: Observer;
  stream?: MediaStream;
  voice?: VoiceSnapshot;
  capture?: { leader: boolean; viewer: string };
  clock: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Only the demo (no capture state) plays a file; a live dashboard waits for a phone.
  const demo = capture === undefined;
  const source = stream ? `stream:${stream.id}` : demo ? `file:${observer.videoUrl}` : "idle";
  const [readySource, setReadySource] = useState<string | null>(null);
  const ready = readySource === source;
  const watch = useAnchorWatch({
    videoRef,
    observerId: observer.id,
    enabled: Boolean(stream && capture && ready),
    leader: capture?.leader ?? false,
    viewer: capture?.viewer ?? "",
  });

  // Boxes, IDs and trails for people and portable things. Only the tab that
  // captures sends frames (two tabs would feed one tracker interleaved); the
  // demo, which has no capture state, plays a file and tracks that.
  const placeHint = useRef<PlaceHint | null>(null);
  useEffect(() => {
    if (watch?.anchor?.active) placeHint.current = { name: watch.anchor.name, at: Date.now() };
  }, [watch?.anchor]);
  const tracks = useLiveTracks({
    videoRef,
    observerId: observer.id,
    place: placeHint,
    viewer: capture?.viewer,
    // The leader tab sends frames; any other tab with the stream follows its results.
    enabled: ready && (stream ? true : capture === undefined),
    follow: Boolean(stream) && !capture?.leader,
  });
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const toggleMark = (object: LiveObject, nowMarked: boolean) => {
    const key = trackKey(object);
    setMarked((current) => {
      const next = new Set(current);
      if (nowMarked) next.add(key);
      else next.delete(key);
      return next;
    });
    clog("tracks", nowMarked ? "marked" : "unmarked", { observer: observer.id, object: key });
    fetch("/api/track/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observerId: observer.id, label: object.label, id: object.id, marked: nowMarked }),
    }).catch(() => {});
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    if (stream) {
      video.removeAttribute("src");
      video.srcObject = stream;
    } else if (demo) {
      video.srcObject = null;
      video.src = observer.videoUrl;
    } else {
      // Live dashboard with no phone connected: show the idle plate, not a file.
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
    video.play()?.catch(() => {});
  }, [stream, observer.videoUrl, demo]);

  const showBreadcrumb =
    observer.phase === "locked" && observer.breadcrumb.length > 0;

  return (
    <article className="relative min-h-0 flex-1 overflow-hidden border border-white/10 bg-panel">
      <SensorPlate id={observer.id} />
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        loop={!stream}
        preload="auto"
        onCanPlay={() => setReadySource(source)}
        onPlaying={() => setReadySource(source)}
        onError={() => setReadySource(null)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-black/55 to-transparent" />

      <div className="absolute top-0 right-0 left-0 z-20 flex items-start justify-between p-4">
        <div>
          {observer.name ? (
            <>
              <p className="text-[13px] tracking-[0.16em] text-white uppercase">
                {observer.name}
              </p>
              <p className="mt-0.5 text-[10px] tracking-[0.18em] text-white/55 uppercase">
                Observer {observer.id}
              </p>
            </>
          ) : (
            <p className="text-[13px] tracking-[0.16em] text-white uppercase">
              Observer {observer.id}
            </p>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-[10px] tracking-[0.18em] text-white/80">
          <span className="live-dot" aria-hidden />
          LIVE
        </p>
      </div>

      {watch?.box && watch.frameSize ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          viewBox={`0 0 ${watch.frameSize.width} ${watch.frameSize.height}`}
          preserveAspectRatio="xMidYMid slice"
        >
          <rect
            x={watch.box.x}
            y={watch.box.y}
            width={watch.box.width}
            height={watch.box.height}
            fill="none"
            stroke={watch.phase === "capturing" ? "#c6a56a" : "rgba(255,255,255,0.7)"}
            strokeWidth={Math.max(2, watch.frameSize.width / 320)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}

      {tracks.status === "tracking" && tracks.frameSize ? (
        <>
          <TrackOverlay objects={tracks.objects} frameSize={tracks.frameSize} marked={marked} onToggle={toggleMark} />
          <p className="pointer-events-none absolute top-14 left-4 z-20 font-mono text-[10px] tracking-[0.16em] text-white/55 uppercase">
            Tracking {tracks.objects.length} object{tracks.objects.length === 1 ? "" : "s"}
            {tracks.ms !== null ? ` · ${tracks.ms} ms` : ""}
            {marked.size > 0 ? ` · ${marked.size} marked` : ""}
          </p>
        </>
      ) : null}

      <SpeechOverlay speech={observer.speech} />
      <VoiceMirror voice={voice} />

      <div className="absolute right-0 bottom-0 left-0 z-20 flex items-end justify-between gap-4 p-4">
        <div className="min-w-0 pr-2">
          {watch ? <WatchBadge watch={watch} leader={capture?.leader ?? false} /> : null}
          {showBreadcrumb ? (
            <SpatialBreadcrumb segments={observer.breadcrumb} tone="overlay" />
          ) : observer.phase === "idle" ? null : (
            <p className="localizing font-mono text-[10px] tracking-[0.18em] text-white/70 uppercase">
              Localizing...
            </p>
          )}
        </div>
        <p className="shrink-0 font-mono text-[10px] tracking-wide text-white/55 tabular-nums">
          {clock}
        </p>
      </div>
    </article>
  );
}
