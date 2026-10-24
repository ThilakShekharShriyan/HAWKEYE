"""WORLDSTATE tracker sidecar.

Runs roboflow/trackers (ByteTrack) on RF-DETR detections. Two modes:

  live     POST /live/{observer}   one JPEG per call, a few times a second. One
           tracker per observer persists across calls, so IDs hold; returns the
           boxes, labels, IDs and short trails the dashboard draws. A ring of
           recent snapshots is kept so an episode can ask what was tracked
           around its keyframe times (POST /live/{observer}/tracks).
  episode  POST /track             the sparse keyframes of one episode, used
           when no live history exists.

Detector: RF-DETR (COCO, 80 classes). It knows people and portable things such
as laptops, bottles, cups and bags. It does NOT know a snack bar or a particular
can: tracks are evidence about people and belongings, not an inventory.

    tracker/.venv/bin/uvicorn server:app --port 8765   (from tracker/)
"""

from __future__ import annotations

import base64
import os
import threading
import time
from collections import deque
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from trackers import ByteTrackTracker

# COCO classes worth reporting at a place where things are kept. Furniture is
# left out: sites are recognised elsewhere, and a chair is not evidence.
KEEP = {
    "person", "laptop", "cell phone", "backpack", "handbag", "suitcase", "book",
    "bottle", "cup", "wine glass", "bowl", "banana", "apple", "orange", "sandwich",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "umbrella", "remote",
    "keyboard", "mouse", "scissors", "teddy bear", "clock", "vase",
}
THRESHOLD = float(os.environ.get("TRACKER_THRESHOLD", "0.3"))
MAX_FRAMES = 24
MAX_WIDTH = 640
LIVE_WIDTH = 480
LIVE_GAP_MS = 5000  # a longer silence means a new scene: start a fresh tracker
LIVE_TRAIL = 14
LIVE_HISTORY = 900  # about three minutes at four frames a second
SNAPSHOT_TOLERANCE_MS = 900

app = FastAPI(title="worldstate-tracker")
_model: Any = None
_lock = threading.Lock()  # one model, one inference at a time


def model():
    global _model
    if _model is None:
        from rfdetr import RFDETRSmall

        _model = RFDETRSmall()
    return _model


def class_names() -> dict[int, str]:
    from rfdetr.assets.coco_classes import COCO_CLASSES

    return dict(COCO_CLASSES) if isinstance(COCO_CLASSES, dict) else dict(enumerate(COCO_CLASSES))


def new_tracker(frame_rate: float) -> ByteTrackTracker:
    # Episode keyframes are about one per second, so IDs must survive large
    # jumps: low activation and IoU thresholds, a short memory, and tracks that
    # count after a single sighting.
    return ByteTrackTracker(
        lost_track_buffer=4,
        frame_rate=max(frame_rate, 1.0),
        track_activation_threshold=0.3,
        minimum_consecutive_frames=1,
        minimum_iou_threshold=0.05,
        high_conf_det_threshold=0.45,
    )


def new_live_tracker() -> ByteTrackTracker:
    # A few frames a second: motion between frames is small enough for IoU
    # matching, and a track survives about three seconds out of view.
    return ByteTrackTracker(
        lost_track_buffer=12,
        frame_rate=4.0,
        track_activation_threshold=0.35,
        minimum_consecutive_frames=1,
        minimum_iou_threshold=0.1,
        high_conf_det_threshold=0.5,
    )


def merge_into(tracks: dict[int, dict], index: int, label: str, tid: int, norm: list[float], conf: float) -> None:
    entry = tracks.setdefault(
        tid, {"id": tid, "label": label, "frames": [], "firstBox": norm, "lastBox": norm, "maxConfidence": 0.0}
    )
    if index not in entry["frames"]:
        entry["frames"].append(index)
    entry["lastBox"] = norm
    entry["maxConfidence"] = round(max(entry["maxConfidence"], conf), 3)


def tracked_objects(tracked: Any, names: dict[int, str], width: int, height: int) -> list[dict]:
    """Confirmed tracks of reportable classes, boxes normalised to 0..1."""
    out = []
    for box, conf, class_id, tid in zip(tracked.xyxy, tracked.confidence, tracked.class_id, tracked.tracker_id):
        if tid is None or int(tid) < 0:
            continue
        label = names.get(int(class_id), str(int(class_id)))
        if label not in KEEP:
            continue
        x1, y1, x2, y2 = (float(v) for v in box)
        norm = [round(min(max(v, 0.0), 1.0), 3) for v in (x1 / width, y1 / height, x2 / width, y2 / height)]
        out.append({"id": int(tid), "label": label, "confidence": round(float(conf), 3), "box": norm})
    return out


def track_frames(frames_rgb: list[np.ndarray], times_ms: list[float]) -> list[dict]:
    """Detect and track across sparse frames; one dict per track, ordered by first sighting."""
    names = class_names()
    span = (times_ms[-1] - times_ms[0]) / 1000 if len(times_ms) > 1 else 0
    tracker = new_tracker((len(frames_rgb) - 1) / span if span > 0 else 1.0)
    tracks: dict[int, dict] = {}
    for index, frame in enumerate(frames_rgb):
        height, width = frame.shape[:2]
        tracked = tracker.update(model().predict(frame, threshold=THRESHOLD))
        for obj in tracked_objects(tracked, names, width, height):
            merge_into(tracks, index, obj["label"], obj["id"], obj["box"], obj["confidence"])
    return sorted(tracks.values(), key=lambda t: (t["frames"][0], t["id"]))


# ---- live sessions -------------------------------------------------------


class Session:
    def __init__(self) -> None:
        self.tracker = new_live_tracker()
        self.last_at = 0.0
        self.seq = 0
        self.trails: dict[int, deque] = {}
        self.history: deque = deque(maxlen=LIVE_HISTORY)  # (at_ms, objects)


_sessions: dict[str, Session] = {}


def session_for(observer: str, at: float) -> Session:
    session = _sessions.get(observer)
    if session is None or (session.last_at and at - session.last_at > LIVE_GAP_MS) or at < session.last_at - LIVE_GAP_MS:
        session = _sessions[observer] = Session()
    return session


def observe(session: Session, frame_rgb: np.ndarray, at: float) -> dict:
    """One live frame: detect, update the observer's tracker, return what to draw."""
    started = time.perf_counter()
    height, width = frame_rgb.shape[:2]
    tracked = session.tracker.update(model().predict(frame_rgb, threshold=THRESHOLD))
    objects = tracked_objects(tracked, class_names(), width, height)
    seen = set()
    for obj in objects:
        x1, y1, x2, y2 = obj["box"]
        trail = session.trails.setdefault(obj["id"], deque(maxlen=LIVE_TRAIL))
        trail.append([round((x1 + x2) / 2, 3), round((y1 + y2) / 2, 3)])
        obj["trail"] = list(trail)
        seen.add(obj["id"])
    session.seq += 1
    session.last_at = max(session.last_at, at)
    session.history.append((at, [{k: v for k, v in o.items() if k != "trail"} for o in objects]))
    if len(session.trails) > 64:
        for tid in [t for t in session.trails if t not in seen][: len(session.trails) - 64]:
            del session.trails[tid]
    return {
        "seq": session.seq,
        "at": at,
        "ms": round((time.perf_counter() - started) * 1000),
        "objects": objects,
    }


def tracks_from_history(session: Session, times_ms: list[float]) -> tuple[list[dict], int]:
    """Tracks as seen around each requested time, from the live snapshots."""
    tracks: dict[int, dict] = {}
    matched = 0
    snapshots = list(session.history)
    for index, at in enumerate(times_ms):
        best = min(snapshots, key=lambda s: abs(s[0] - at), default=None)
        if best is None or abs(best[0] - at) > SNAPSHOT_TOLERANCE_MS:
            continue
        matched += 1
        for obj in best[1]:
            merge_into(tracks, index, obj["label"], obj["id"], obj["box"], obj["confidence"])
    return sorted(tracks.values(), key=lambda t: (t["frames"][0], t["id"])), matched


# ---- decoding ------------------------------------------------------------


def decode_bytes(raw: bytes, max_width: int = MAX_WIDTH) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("frame is not a decodable image")
    if frame.shape[1] > max_width:
        scale = max_width / frame.shape[1]
        frame = cv2.resize(frame, (max_width, round(frame.shape[0] * scale)))
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def decode(image_b64: str) -> np.ndarray:
    return decode_bytes(base64.b64decode(image_b64.split(",", 1)[-1]))


class Frame(BaseModel):
    image: str
    at: float  # milliseconds, any epoch; only spacing matters


class TrackRequest(BaseModel):
    frames: list[Frame]


class TimesRequest(BaseModel):
    times: list[float]


@app.on_event("startup")
def warm_up() -> None:
    """Load the weights and run one frame now, so the first real episode is not the slow one."""
    model().predict(np.zeros((360, 640, 3), dtype=np.uint8), threshold=THRESHOLD)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "loaded": _model is not None,
        "detector": "rf-detr-small",
        "tracker": "bytetrack",
        "liveSessions": {k: {"frames": s.seq, "history": len(s.history)} for k, s in _sessions.items()},
    }


@app.post("/track")
def track(request: TrackRequest) -> dict:
    if not request.frames:
        raise HTTPException(400, "frames required")
    frames = sorted(request.frames, key=lambda f: f.at)[-MAX_FRAMES:]
    try:
        decoded = [decode(f.image) for f in frames]
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    with _lock:
        started = cv2.getTickCount()
        tracks = track_frames(decoded, [f.at for f in frames])
        ms = round((cv2.getTickCount() - started) / cv2.getTickFrequency() * 1000)
    return {"frames": len(decoded), "ms": ms, "tracks": tracks}


@app.post("/live/{observer}")
async def live(observer: str, request: Request) -> dict:
    raw = await request.body()
    try:
        frame = decode_bytes(raw, LIVE_WIDTH)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    try:
        at = float(request.headers.get("x-frame-at") or time.time() * 1000)
    except ValueError:
        at = time.time() * 1000

    def work() -> dict:
        with _lock:
            return observe(session_for(observer, at), frame, at)

    return await run_in_threadpool(work)


@app.post("/live/{observer}/tracks")
def live_tracks(observer: str, request: TimesRequest) -> dict:
    session = _sessions.get(observer)
    if session is None or not request.times:
        return {"tracks": [], "matched": 0}
    with _lock:
        tracks, matched = tracks_from_history(session, request.times)
    return {"tracks": tracks, "matched": matched}


@app.delete("/live/{observer}")
def live_reset(observer: str) -> dict:
    return {"reset": _sessions.pop(observer, None) is not None}
