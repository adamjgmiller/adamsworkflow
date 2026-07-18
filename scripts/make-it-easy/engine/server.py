#!/usr/bin/env python3
"""make-it-easy — tiny stdlib server: static app + JSON state persistence.

  GET  /                -> index.html
  GET  /api/state       -> current saved answers (or {})
  POST /api/state       -> replace saved answers (autosave), stamps updatedAt
  POST /api/complete    -> stamps submittedAt + writes state/SUBMITTED sentinel
  GET  /api/health      -> {"ok": true}

Single user. By default, serve on 127.0.0.1 (localhost-only). To open pages
from other devices, opt in explicitly: bind 0.0.0.0 on a trusted network, or
preferably bind a private tailnet/VPN interface (e.g. Tailscale) — see the
README's serving section. Set MIE_BIND to the interface to bind and MIE_HOST
to the hostname/IP shown in the printed URL (MIE_BIND defaults to MIE_HOST).
"""
import json, os, sys, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(ROOT, "state")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
SENTINEL = os.path.join(STATE_DIR, "SUBMITTED")
PORT_FILE = os.path.join(STATE_DIR, "PORT")
HOST_FILE = os.path.join(STATE_DIR, "HOST")  # display host, read back by `mie.py url`
PORT = int(os.environ.get("PORT", "0"))  # 0 = OS assigns a free port (multi-instance safe)
HOST = os.environ.get("MIE_HOST", "127.0.0.1")   # hostname/IP shown in the URL
BIND = os.environ.get("MIE_BIND", HOST)          # interface to bind; defaults to HOST
MAX_BODY = 5 * 1024 * 1024                        # cap request bodies (single-user blob is tiny)
_LOCK = threading.Lock()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ico": "image/x-icon",
}


def _read_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_state(obj):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, STATE_FILE)  # atomic


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _safe_path(self, urlpath):
        rel = urlpath.lstrip("/") or "index.html"
        # realpath + commonpath (mirrors media_gen._inside_run): resolves symlinks so a
        # link under ROOT that points outside ROOT is rejected — unlike lexical normpath,
        # which a symlink could slip past.
        full = os.path.realpath(os.path.join(ROOT, rel))
        root_real = os.path.realpath(ROOT)
        if os.path.commonpath([full, root_real]) != root_real:  # block traversal + escapes
            return None
        return full

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._json({"ok": True})
        if path == "/api/state":
            with _LOCK:
                return self._json(_read_state())

        full = self._safe_path(path)
        if not full or os.path.isdir(full) or not os.path.exists(full):
            self.send_error(404, "Not found")
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404, "Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # html/js/css/json: no-store so state/spec are always fresh; media can cache within a run
        self.send_header("Cache-Control", "no-store" if ext in (".html", ".js", ".css", ".json") else "max-age=3600")
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        """Parse the JSON request body, returning (error, obj).

        error is None on success (obj is a dict). Otherwise it is an (code, msg)
        pair the caller turns into a structured response instead of crashing on a
        malformed request: non-numeric/oversized Content-Length, bad JSON/encoding,
        or a non-object top-level value.
        """
        raw = self.headers.get("Content-Length", "0") or "0"
        try:
            length = int(raw)
        except ValueError:
            return (400, "bad content-length"), None
        if length < 0:
            return (400, "bad content-length"), None
        if length > MAX_BODY:
            return (413, "payload too large"), None
        if length == 0:
            return None, {}
        try:
            obj = json.loads(self.rfile.read(length).decode() or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return (400, "bad json"), None
        if not isinstance(obj, dict):
            return (400, "body must be a json object"), None
        return None, obj

    def do_POST(self):
        path = urlparse(self.path).path
        err, body = self._read_body()
        if err is not None:
            code, msg = err
            # body may be unread (oversize) or its length unknown (bad length) — don't
            # reuse a possibly-desynced keep-alive connection.
            self.close_connection = True
            return self._json({"ok": False, "error": msg}, code)

        if path == "/api/state":
            with _LOCK:
                state = _read_state()
                if "createdAt" not in state:
                    state["createdAt"] = time.time()
                # client owns the answers blob; server stamps time
                state["answers"] = body.get("answers", state.get("answers", {}))
                state["cursor"] = body.get("cursor", state.get("cursor", 0))
                state["updatedAt"] = time.time()
                _write_state(state)
            return self._json({"ok": True})

        if path == "/api/complete":
            with _LOCK:
                state = _read_state()
                state["answers"] = body.get("answers", state.get("answers", {}))
                state["submittedAt"] = time.time()
                _write_state(state)
                # sentinel MUST be written last: external `mie.py wait` keys off it, then reads
                # state.json — so state must be fully replaced before SUBMITTED appears.
                with open(SENTINEL, "w") as f:
                    f.write(str(state["submittedAt"]))
            return self._json({"ok": True})

        self.send_error(404, "Not found")


def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    actual = srv.server_address[1]                  # real port (when PORT=0, the OS picked one)
    host = HOST
    tmp = PORT_FILE + ".tmp"                         # publish the real port atomically
    with open(tmp, "w") as f:
        f.write(str(actual))
    os.replace(tmp, PORT_FILE)
    htmp = HOST_FILE + ".tmp"                         # publish the display host atomically
    with open(htmp, "w") as f:                        # so `mie.py url` prints the serving host
        f.write(host)
    os.replace(htmp, HOST_FILE)
    print(f"PORT={actual}")
    print(f"URL=http://{host}:{actual}")
    print(f"make-it-easy serving on http://{host}:{actual}  (bind={BIND})")
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
