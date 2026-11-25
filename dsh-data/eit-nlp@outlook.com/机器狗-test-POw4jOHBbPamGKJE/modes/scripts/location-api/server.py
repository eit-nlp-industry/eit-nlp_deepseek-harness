#!/usr/bin/env python3
"""MapPreview 联调：GET /api/location?trackId=… 的 SSE 位置流。

测试轨迹 patrol-42：起点 ↔ 221 办公室来回移动，约 2 秒一帧。
同轨迹内 seq 递增，重连不重置。不发送 arrived，避免前端关闭连接。

用法：
  python3 server.py
  curl -N 'http://127.0.0.1:13802/api/location?trackId=patrol-42'
"""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 13802
# 1 帧/秒；单程 5 分钟 = 300 步，来回一圈约 10 分钟。
FRAME_INTERVAL_S = 1.0
STEPS_ONE_WAY = 300

ALLOWED_TRACK_IDS = frozenset({"patrol-42"})

START = {"x": 22.0, "y": 62.0, "heading": 50.0}
OFFICE = {"x": 62.0, "y": 42.0, "heading": 230.0}


def lerp_path(start: dict[str, float], end: dict[str, float], heading: float, steps: int) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for i in range(1, steps + 1):
        t = i / steps
        frames.append({
            "x": round(start["x"] + (end["x"] - start["x"]) * t, 2),
            "y": round(start["y"] + (end["y"] - start["y"]) * t, 2),
            "heading": heading,
            "status": "moving",
        })
    return frames


OUTBOUND = lerp_path(START, OFFICE, 50.0, STEPS_ONE_WAY)
INBOUND = lerp_path(OFFICE, START, 230.0, STEPS_ONE_WAY)
LOOP_FRAMES = OUTBOUND + INBOUND


class TrackState:
    def __init__(self, track_id: str) -> None:
        self.track_id = track_id
        self.lock = threading.Lock()
        self.seq = 0
        self.x = START["x"]
        self.y = START["y"]
        self.heading = START["heading"]
        self.status = "idle"
        self.frame_index = 0
        self.subscribers: list[threading.Event] = []
        self.ticker: threading.Thread | None = None
        self.version = 0
        self.stop = threading.Event()

    def snapshot(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "trackId": self.track_id,
            "seq": self.seq,
            "x": self.x,
            "y": self.y,
            "status": self.status,
        }
        if self.heading is not None:
            body["heading"] = self.heading
        return body

    def _publish_locked(self) -> None:
        self.version += 1
        for event in list(self.subscribers):
            event.set()

    def ensure_running(self) -> None:
        with self.lock:
            if self.ticker is None or not self.ticker.is_alive():
                self.stop.clear()
                self.ticker = threading.Thread(
                    target=self._run_loop, name=f"track-{self.track_id}", daemon=True
                )
                self.ticker.start()

    def _run_loop(self) -> None:
        while not self.stop.is_set():
            time.sleep(FRAME_INTERVAL_S)
            if self.stop.is_set():
                return
            with self.lock:
                frame = LOOP_FRAMES[self.frame_index % len(LOOP_FRAMES)]
                self.frame_index += 1
                self.seq += 1
                self.x = float(frame["x"])
                self.y = float(frame["y"])
                self.heading = float(frame["heading"])
                self.status = str(frame["status"])
                self._publish_locked()

    def subscribe(self) -> tuple[threading.Event, int]:
        event = threading.Event()
        with self.lock:
            self.subscribers.append(event)
            return event, self.version

    def unsubscribe(self, event: threading.Event) -> None:
        with self.lock:
            if event in self.subscribers:
                self.subscribers.remove(event)


TRACKS: dict[str, TrackState] = {tid: TrackState(tid) for tid in ALLOWED_TRACK_IDS}


def format_sse(payload: dict[str, Any]) -> bytes:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: position\ndata: {data}\n\n".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _send_json(self, code: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/location":
            self._send_json(404, {"error": "not found"})
            return

        qs = parse_qs(parsed.query)
        track_id = (qs.get("trackId") or [""])[0].strip()
        if not track_id:
            self._send_json(400, {"error": "trackId required"})
            return
        if track_id not in ALLOWED_TRACK_IDS:
            self._send_json(403, {"error": "trackId not allowed"})
            return

        track = TRACKS[track_id]
        track.ensure_running()

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        event, last_version = track.subscribe()
        try:
            with track.lock:
                snap = track.snapshot()
                last_version = track.version
            self.wfile.write(format_sse(snap))
            self.wfile.flush()

            while True:
                signaled = event.wait(timeout=15.0)
                event.clear()
                if not signaled:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                with track.lock:
                    if track.version == last_version:
                        continue
                    last_version = track.version
                    snap = track.snapshot()
                self.wfile.write(format_sse(snap))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            track.unsubscribe(event)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"location SSE on http://{HOST}:{PORT}/api/location?trackId=patrol-42 "
        f"(loops start↔221)",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
