"use client";

import { useEffect, useState, type RefObject } from "react";
import { clog } from "@/lib/client-log";
import type { LiveObject } from "@/lib/tracker";
import type { ObserverId } from "@/lib/types";

const SEND_EVERY_MS = 250;
const SEND_WIDTH = 480;
const JPEG_QUALITY = 0.6;
// With no answer for this long the boxes are stale: take them down.
const STALE_MS = 1500;
const OFF_RECHECK_MS = 30_000;
const ERROR_BACKOFF_MS = 2000;
// A saved place counts as in view for this long after the anchor matcher last saw it.
const PLACE_STICKY_MS = 5000;

/** The saved place the dashboard last recognised in this feed, and when. */
export type PlaceHint = { name: string; at: number };

export type LiveTracks = {
  status: "off" | "tracking" | "unavailable";
  objects: LiveObject[];
  frameSize: { width: number; height: number } | null;
  /** Round-trip time of the latest frame, including detection. */
  ms: number | null;
};

const OFF: LiveTracks = { status: "off", objects: [], frameSize: null, ms: null };

/**
 * Sends the observer's video to the tracker a few times a second and returns
 * what it found: boxes, labels, persistent IDs and trails. Self-paced (one
 * request at a time), and quiet when live tracking is not switched on.
 */
export function useLiveTracks({
  videoRef,
  observerId,
  enabled,
  follow = false,
  place,
  viewer,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  observerId: ObserverId;
  enabled: boolean;
  /** A tab that does not hold the capture lease: show what the leader's tracker found instead of sending frames. */
  follow?: boolean;
  /** Which saved place is in view; sent so a change the tracker proves can be recorded there. */
  place?: RefObject<PlaceHint | null>;
  /** This tab's capture-lease id; the server only writes counts for the lease holder. */
  viewer?: string;
}) {
  const [tracks, setTracks] = useState<LiveTracks>(OFF);

  useEffect(() => {
    if (!enabled) return;

    if (follow) {
      let stopped = false;
      let timer = 0;
      const poll = async () => {
        let delay = SEND_EVERY_MS;
        try {
          const response = await fetch(`/api/track/live/${observerId}`, { cache: "no-store" });
          const body = (await response.json()) as { enabled?: boolean; objects?: LiveObject[]; ms?: number; ageMs?: number | null };
          if (stopped) return;
          const video = videoRef.current;
          if (body.enabled === false) {
            setTracks(OFF);
            delay = OFF_RECHECK_MS;
          } else if (body.ageMs != null && body.ageMs < STALE_MS && video?.videoWidth) {
            setTracks({
              status: "tracking",
              objects: body.objects ?? [],
              frameSize: { width: video.videoWidth, height: video.videoHeight },
              ms: body.ms ?? null,
            });
          } else {
            setTracks(OFF);
          }
        } catch {
          if (!stopped) setTracks(OFF);
          delay = ERROR_BACKOFF_MS;
        }
        if (!stopped) timer = window.setTimeout(poll, delay);
      };
      poll();
      return () => {
        stopped = true;
        window.clearTimeout(timer);
        setTracks(OFF);
      };
    }
    let stopped = false;
    let timer = 0;
    let lastGoodAt = 0;
    let failures = 0;
    const canvas = document.createElement("canvas");

    const schedule = (ms: number) => {
      if (!stopped) timer = window.setTimeout(step, ms);
    };

    const toBlob = () =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));

    async function step() {
      const started = Date.now();
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused) {
        schedule(SEND_EVERY_MS);
        return;
      }
      canvas.width = Math.min(SEND_WIDTH, video.videoWidth);
      canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob();
      if (!blob || stopped) return schedule(SEND_EVERY_MS);
      try {
        const hint = place?.current;
        const params = new URLSearchParams();
        if (hint && Date.now() - hint.at < PLACE_STICKY_MS) params.set("place", hint.name);
        if (viewer) params.set("viewer", viewer);
        const query = params.size > 0 ? `?${params}` : "";
        const response = await fetch(`/api/track/live/${observerId}${query}`, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg", "X-Frame-At": String(started) },
          body: blob,
        });
        const body = (await response.json()) as {
          enabled?: boolean;
          objects?: LiveObject[];
          ms?: number;
          committed?: { applied?: boolean; item?: string; from?: number; to?: number }[];
        };
        if (stopped) return;
        if (body.enabled === false) {
          // Not switched on (no sidecar or TRACKER_LIVE unset): stop sending, look again later.
          setTracks(OFF);
          clog("tracks", "live tracking is off on the server", { observer: observerId });
          return schedule(OFF_RECHECK_MS);
        }
        if (!response.ok || !body.objects) throw new Error(`track ${response.status}`);
        failures = 0;
        lastGoodAt = Date.now();
        for (const change of body.committed ?? []) {
          if (change.applied) clog("tracks", "change recorded from the tracker", { observer: observerId, ...change });
        }
        setTracks({
          status: "tracking",
          objects: body.objects,
          frameSize: { width: video.videoWidth, height: video.videoHeight },
          ms: Date.now() - started,
        });
        schedule(Math.max(0, SEND_EVERY_MS - (Date.now() - started)));
      } catch (cause) {
        failures += 1;
        if (failures === 3) clog("tracks", "live tracking failing", { observer: observerId, error: String(cause).slice(0, 160) });
        if (!stopped && Date.now() - lastGoodAt > STALE_MS) {
          setTracks((current) => (current.status === "unavailable" ? current : { ...OFF, status: "unavailable" }));
        }
        schedule(ERROR_BACKOFF_MS);
      }
    }

    schedule(0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      setTracks(OFF);
    };
  }, [enabled, follow, observerId, videoRef, place, viewer]);

  return enabled ? tracks : OFF;
}
