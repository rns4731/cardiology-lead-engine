"""Serve the web app's data from Postgres.

nginx proxies /data/* here, so the browser gets the same JSON contract the exporter writes
to disk -- manifest.json and <source>/bundle.json -- read from the database instead: each
source's current export (the current_export_run view). The web code doesn't change, and
the engine still computes everything; this only delivers what the loader stored.

    .venv/bin/python -m engine.db.serve        # http://localhost:8000/data/manifest.json
    docker compose up --build -d               # browser -> nginx :8080 -> api -> Postgres
"""
from __future__ import annotations

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from engine.db import get_engine
from engine.db.load import require_head
from engine.db.read import bundle, current_runs, served_manifest

HOST = os.environ.get("API_HOST", "0.0.0.0")
PORT = int(os.environ.get("API_PORT", "8000"))
BUNDLE_PATH = re.compile(r"^/data/([a-z][a-z0-9_-]*)/bundle\.json$")


def _json(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()


class DataServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr: tuple[str, int], engine: Engine):
        super().__init__(addr, Handler)
        self.engine = engine
        self._cache: dict[str, tuple[int, bytes]] = {}  # source -> (export run id, JSON)
        self._lock = threading.Lock()

    def bundle_json(self, source: str) -> tuple[int, bytes] | None:
        """The current bundle for `source`, serialized once per export run (~2 MB each)."""
        with self.engine.connect() as conn:
            run = current_runs(conn).get(source)
            if run is None:
                return None
            with self._lock:
                hit = self._cache.get(source)
            if hit and hit[0] == run:
                return hit
            body = _json(bundle(conn, source, run))
        with self._lock:
            self._cache[source] = (run, body)
        return run, body


class Handler(BaseHTTPRequestHandler):
    server: DataServer
    server_version = "lead-engine-api"

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        try:
            if path == "/healthz":  # healthy once Postgres answers and holds at least one export
                with self.server.engine.connect() as conn:
                    n = len(current_runs(conn))
                return self._send(200 if n else 503, _json({"sources": n}))
            if path == "/data/manifest.json":
                with self.server.engine.connect() as conn:
                    return self._send(200, _json(served_manifest(conn)))
            match = BUNDLE_PATH.match(path)
            hit = self.server.bundle_json(match.group(1)) if match else None
            if hit:
                return self._send(200, hit[1], run=hit[0])
            return self._send(404, _json({"error": f"not found: {path}"}))
        except SQLAlchemyError as e:
            return self._send(503, _json({"error": f"database unavailable ({type(e).__name__})"}))

    def _send(self, status: int, body: bytes, run: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Data-Source", "postgres" + (f"; export_run={run}" if run else ""))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        if not self.path.startswith("/healthz"):  # health probes every few seconds: not news
            super().log_message(fmt, *args)


def main() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        require_head(conn)
    server = DataServer((HOST, PORT), engine)
    print(f"serving /data from Postgres on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
