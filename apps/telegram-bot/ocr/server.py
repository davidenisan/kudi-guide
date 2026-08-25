"""
Local OCR service.

PaddleOCR is Python and the bot is Node, so they have to be separate processes.
This is the smaller half: it holds the models in memory and answers one question
— "what text is in these bytes, where, and how sure are you" — over localhost.

Deliberately dumb. It knows nothing about receipts, amounts, banks or Nigeria.
Deciding what the text means is the bot's job (see core/receipt/), which keeps
the interesting logic in one language and makes this replaceable by any other
OCR engine that can return the same shape.

Long-running on purpose: loading the models takes a second or two, and spawning
a process per receipt would pay that every time for nothing.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_PORT", "8765"))

# Bytes, not a path: the bot has the file in memory and there is no reason to
# put a user's receipt on disk just to hand it over.
MAX_BYTES = 20 * 1024 * 1024

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ocr")

_engine: Any = None
_engine_lock = threading.Lock()


def engine() -> Any:
    """The OCR engine, loaded once on first use."""
    global _engine
    with _engine_lock:
        if _engine is None:
            from paddleocr import PaddleOCR

            log.info("loading PaddleOCR models")
            # Orientation classification is off: bank screenshots are upright,
            # and it costs time on every page for a case we do not have.
            _engine = PaddleOCR(use_textline_orientation=False, lang="en")
            log.info("PaddleOCR ready")
        return _engine


def pdf_to_image(data: bytes) -> tuple[bytes | None, str | None]:
    """
    Renders page 1 of a PDF, but only after looking for real text.

    Bank-emailed receipts often carry a text layer, and reading it is exact,
    instant and free of OCR error entirely (Section 5). Rasterising first would
    throw that away and then guess at what it threw away.
    """
    try:
        import pymupdf
    except ImportError:
        return None, "pymupdf is not installed"

    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.page_count == 0:
                return None, "pdf has no pages"
            page = doc.load_page(0)

            embedded = page.get_text("text").strip()
            if len(embedded) >= 40:
                return None, f"__TEXT_LAYER__{embedded}"

            # No usable text layer, so rasterise. 2x for small type.
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
            return pixmap.tobytes("png"), None
    except Exception as error:  # noqa: BLE001 - any failure means "cannot read"
        return None, f"could not read pdf: {error}"


def run_ocr(data: bytes) -> dict[str, Any]:
    """Returns every line found, with its confidence and where it sits."""
    import numpy as np
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    # PaddleOCR wants three channels; screenshots are often RGBA or greyscale.
    if image.mode != "RGB":
        image = image.convert("RGB")

    pages = engine().predict(np.array(image))

    lines: list[dict[str, Any]] = []
    for page in pages:
        texts = page.get("rec_texts", [])
        scores = page.get("rec_scores", [])
        boxes = page.get("rec_polys", [])

        for text, score, box in zip(texts, scores, boxes):
            points = [[float(x), float(y)] for x, y in box]
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            lines.append(
                {
                    "text": str(text),
                    "confidence": float(score),
                    # A simple box is easier to reason about than four corners
                    # when working out what sits nearest a label.
                    "box": {
                        "left": min(xs),
                        "top": min(ys),
                        "right": max(xs),
                        "bottom": max(ys),
                    },
                }
            )

    return {
        "lines": lines,
        "width": image.width,
        "height": image.height,
        "source": "ocr",
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s", fmt % args)

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path == "/health":
            self._send(200, {"ok": True, "loaded": _engine is not None})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/extract":
            self._send(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BYTES * 2:
                self._send(413, {"error": "request too large"})
                return

            request = json.loads(self.rfile.read(length))
            data = base64.b64decode(request["bytes"])
            mime_type = request.get("mimeType") or ""

            if len(data) > MAX_BYTES:
                self._send(413, {"error": "file too large"})
                return

            if mime_type == "application/pdf" or data[:4] == b"%PDF":
                rendered, note = pdf_to_image(data)
                if note and note.startswith("__TEXT_LAYER__"):
                    # Exact text beats anything OCR could produce.
                    text = note[len("__TEXT_LAYER__") :]
                    self._send(
                        200,
                        {
                            "lines": [
                                {"text": line, "confidence": 1.0, "box": None}
                                for line in text.splitlines()
                                if line.strip()
                            ],
                            "width": 0,
                            "height": 0,
                            "source": "pdf-text-layer",
                        },
                    )
                    return
                if rendered is None:
                    self._send(422, {"error": note or "could not read pdf"})
                    return
                data = rendered

            self._send(200, run_ocr(data))

        except Exception as error:  # noqa: BLE001 - never take the service down
            log.exception("extract failed")
            self._send(500, {"error": str(error)})


def main() -> None:
    # Load before serving, so the first receipt isn't waiting on model init.
    engine()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("OCR service listening on http://%s:%d", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("stopping")
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
