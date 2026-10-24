"""Checks the sidecar end to end on the repo's demo videos.

    cd tracker && .venv/bin/python verify.py

Samples keyframes the way the dashboard does (about one per second, JPEG at
640 px), posts them to /track and asserts what the tracker should and should
not see. Exits non-zero on any failed expectation.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import cv2
from fastapi.testclient import TestClient

from server import app

VIDEOS = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "videos"


def keyframes(path: Path, per_second: float = 1.0, max_frames: int = 8) -> list[dict]:
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(fps / per_second))
    out, index = [], 0
    while len(out) < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if index % step == 0:
            width = 640
            frame = cv2.resize(frame, (width, round(frame.shape[0] * width / frame.shape[1])))
            _, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 72])
            out.append({"image": base64.b64encode(jpg.tobytes()).decode(), "at": index / fps * 1000})
        index += 1
    return out


failures: list[str] = []


def expect(ok: bool, message: str) -> None:
    print(("ok   " if ok else "FAIL ") + message)
    if not ok:
        failures.append(message)


with TestClient(app) as client:
    health = client.get("/health").json()
    expect(health["ok"] is True, "health ok")

    expect(client.post("/track", json={"frames": []}).status_code == 400, "empty request rejected")
    expect(
        client.post("/track", json={"frames": [{"image": "bm90IGFuIGltYWdl", "at": 0}]}).status_code == 400,
        "undecodable frame rejected",
    )

    snack = keyframes(VIDEOS / "02-recognise-and-take-snack.mov", per_second=2.0, max_frames=12)
    result = client.post("/track", json={"frames": snack}).json()
    people = [t for t in result["tracks"] if t["label"] == "person"]
    print(f"  02 snack: {len(snack)} frames, {result['ms']} ms, tracks: "
          f"{[(t['label'], t['id'], t['frames']) for t in result['tracks']]}")
    expect(len(people) >= 1, "a person is tracked in the take-a-snack video")
    expect(all(t["frames"] == sorted(set(t["frames"])) for t in result["tracks"]), "frame indexes are sorted and unique")
    expect(
        all(0 <= v <= 1 for t in result["tracks"] for v in t["firstBox"] + t["lastBox"]),
        "boxes are normalised to 0..1",
    )

    shuffled = client.post("/track", json={"frames": list(reversed(snack))}).json()
    expect(
        [(t["label"], t["frames"]) for t in shuffled["tracks"]] == [(t["label"], t["frames"]) for t in result["tracks"]],
        "frame order in the request does not matter (sorted by time)",
    )

    # Live mode: one JPEG per call at a few frames a second, one tracker per
    # observer, so IDs persist and trails grow.
    client.delete("/live/verify")
    live_frames = keyframes(VIDEOS / "02-recognise-and-take-snack.mov", per_second=4.0, max_frames=24)
    base = 1_000_000.0
    replies = []
    for k, frame in enumerate(live_frames):
        raw = base64.b64decode(frame["image"])
        reply = client.post(
            "/live/verify", content=raw, headers={"Content-Type": "image/jpeg", "X-Frame-At": str(base + k * 250)}
        )
        expect(reply.status_code == 200, f"live frame {k} accepted") if reply.status_code != 200 else None
        replies.append(reply.json())
    ids_by_label: dict[str, set[int]] = {}
    for reply in replies:
        for obj in reply["objects"]:
            ids_by_label.setdefault(obj["label"], set()).add(obj["id"])
    print(f"  live: {len(replies)} frames, median {sorted(r['ms'] for r in replies)[len(replies) // 2]} ms, ids {ids_by_label}")
    expect(all(r["seq"] == i + 1 for i, r in enumerate(replies)), "one tracker persists across live frames (seq counts up)")
    expect("person" in ids_by_label, "live: a person is tracked")
    longest = max((len(o["trail"]) for r in replies for o in r["objects"]), default=0)
    expect(longest >= 3, f"live: trails grow ({longest} points)")
    expect(
        all(0 <= v <= 1 for r in replies for o in r["objects"] for v in o["box"]),
        "live: boxes are normalised to 0..1",
    )
    expect(
        client.post("/live/verify", content=b"nope", headers={"Content-Type": "image/jpeg"}).status_code == 400,
        "live: undecodable frame rejected",
    )

    times = [base + k * 250 for k in range(len(live_frames))]
    history = client.post("/live/verify/tracks", json={"times": times[::4]}).json()
    expect(history["matched"] == len(times[::4]), "history: every requested time found a live snapshot")
    expect(
        client.post("/live/verify/tracks", json={"times": [base + 10_000_000]}).json()["matched"] == 0,
        "history: a time with no nearby snapshot matches nothing",
    )
    expect(client.post("/live/never-seen/tracks", json={"times": [1]}).json()["tracks"] == [], "history: unknown observer has no tracks")
    expect(client.delete("/live/verify").json()["reset"] is True, "session can be reset")

sys.exit(1 if failures else 0)
