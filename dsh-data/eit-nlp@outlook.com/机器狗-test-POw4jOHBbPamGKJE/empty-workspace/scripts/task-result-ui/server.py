#!/usr/bin/env python3
"""本地页面：输入 task_id → 调用 post-robot-task-result.sh。"""
from __future__ import annotations

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "post-robot-task-result.sh"
INDEX = HERE / "index.html"
HOST = "127.0.0.1"
PORT = 13801


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
            return
        self._send(404, b"not found\n", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/complete":
            self._send(404, b'{"error":"not found"}\n', "application/json; charset=utf-8")
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b'{"error":"invalid json"}\n', "application/json; charset=utf-8")
            return

        task_id = str(payload.get("task_id") or "").strip()
        if not task_id:
            self._send(400, b'{"error":"task_id required"}\n', "application/json; charset=utf-8")
            return

        if not SCRIPT.is_file():
            msg = json.dumps({"error": f"script missing: {SCRIPT}"}, ensure_ascii=False).encode()
            self._send(500, msg, "application/json; charset=utf-8")
            return

        try:
            proc = subprocess.run(
                ["bash", str(SCRIPT), task_id],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired:
            self._send(504, b'{"error":"script timeout"}\n', "application/json; charset=utf-8")
            return

        output = (proc.stdout or "") + (proc.stderr or "")
        body = json.dumps(
            {
                "ok": proc.returncode == 0,
                "exit_code": proc.returncode,
                "task_id": task_id,
                "output": output.strip() or "(no output)",
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self._send(200 if proc.returncode == 0 else 500, body, "application/json; charset=utf-8")


def main() -> None:
    if not SCRIPT.is_file():
        raise SystemExit(f"找不到脚本: {SCRIPT}")
    # Only the file owner can chmod; shared 777 scripts are already executable.
    try:
        SCRIPT.chmod(SCRIPT.stat().st_mode | 0o111)
    except PermissionError:
        if not os.access(SCRIPT, os.X_OK):
            raise SystemExit(f"脚本不可执行且无法 chmod: {SCRIPT}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"打开页面: http://{HOST}:{PORT}/")
    print(f"脚本: {SCRIPT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
