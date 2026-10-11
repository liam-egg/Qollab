"""Local preview that mimics Qollab's runtime closely enough to develop against.

On Qollab, main.js imports the Python module ``lens.service`` directly. Here an
import map points that name at dev/service-shim.js, which forwards each call to
this server, which calls the same Python functions.

    python dev/serve.py            # then open http://localhost:8765
"""

from __future__ import annotations

import http.server
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lens import service  # noqa: E402

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transpile Lens (local preview)</title>
<link rel="stylesheet" href="/main.css">
<script type="importmap">{{"imports": {{"lens.service": "/dev/service-shim.js"}}}}</script>
</head><body>
{body}
<script type="module" src="/main.js"></script>
</body></html>"""

CALLS = {"list_presets": service.list_presets, "get_trace": service.get_trace, "trace_qasm": service.trace_qasm}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = (ROOT / "index.html").read_text(encoding="utf-8")
            self._send(PAGE.format(body=body).encode(), "text/html; charset=utf-8")
            return
        super().do_GET()

    def do_POST(self):
        name = self.path.removeprefix("/api/")
        if name not in CALLS:
            self.send_error(404)
            return
        args = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"[]")
        self._send(CALLS[name](*args).encode(), "application/json")

    def _send(self, data: bytes, ctype: str):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    import os

    os.chdir(ROOT)  # service.py reads data files relative to the project root
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Transpile Lens preview on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
