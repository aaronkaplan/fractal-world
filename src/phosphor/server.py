"""Serve the experiment and accept same-origin PNG captures on loopback only."""

import argparse
import json
import logging
import struct
import zlib
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

LOGGER = logging.getLogger("phosphor")
PROGRAM_DIRECTORY = Path(__file__).resolve().parents[2]
MAX_CAPTURE_BYTES = 64 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def validate_png(data: bytes) -> None:
    """Validate PNG framing and checksums without decoding untrusted pixels."""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("Expected a PNG image")
    position = len(PNG_SIGNATURE)
    saw_header = False
    saw_data = False
    while position + 12 <= len(data):
        length = struct.unpack_from(">I", data, position)[0]
        end = position + 12 + length
        if end > len(data):
            raise ValueError("Truncated PNG chunk")
        kind = data[position + 4 : position + 8]
        payload = data[position + 8 : position + 8 + length]
        checksum = struct.unpack_from(">I", data, end - 4)[0]
        if zlib.crc32(kind + payload) != checksum:
            raise ValueError("Invalid PNG checksum")
        if not saw_header:
            if kind != b"IHDR" or length != 13:
                raise ValueError("Missing PNG header")
            width, height = struct.unpack_from(">II", payload)
            if not 0 < width <= 32768 or not 0 < height <= 32768:
                raise ValueError("Unsupported PNG dimensions")
            saw_header = True
        elif kind == b"IHDR":
            raise ValueError("Duplicate PNG header")
        if kind == b"IDAT":
            saw_data = True
        if kind == b"IEND":
            if length != 0 or end != len(data) or not saw_data:
                raise ValueError("Invalid PNG ending")
            return
        position = end
    raise ValueError("Incomplete PNG image")


def save_capture(directory: Path, data: bytes, mode: str) -> str:
    """Validate and exclusively create a timestamped PNG in the program directory."""
    validate_png(data)
    if mode not in {"lines", "mandelbrot"}:
        mode = "display"
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
    filename = f"phosphor-{mode}-{timestamp}-{uuid4().hex[:8]}.png"
    with (directory / filename).open("xb") as capture:
        capture.write(data)
    LOGGER.info(json.dumps({"event": "capture_saved", "file": filename, "bytes": len(data)}))
    return filename


def create_app(directory: Path = PROGRAM_DIRECTORY, port: int = 8000) -> FastAPI:
    """Build the loopback screenshot API and static experiment application."""
    app = FastAPI(title="Phosphor local capture", docs_url=None, redoc_url=None)
    directory = directory.resolve()
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    @app.post("/__capture", status_code=201)
    # Guard clauses keep every rejected upload away from the file-writing path.
    async def capture(request: Request):  # pylint: disable=too-many-return-statements
        host = request.headers.get("host", "")
        # No CORS permission is granted. The custom header and origin checks
        # prevent unrelated websites from writing through the loopback helper.
        if (
            host not in allowed_hosts
            or request.headers.get("origin") != f"http://{host}"
            or request.headers.get("x-phosphor-capture") != "1"
        ):
            return JSONResponse({"error": "Capture requires the local page"}, status_code=403)
        if request.headers.get("content-type") != "image/png":
            return JSONResponse({"error": "Expected image/png"}, status_code=415)
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_CAPTURE_BYTES:
            return JSONResponse({"error": "Invalid screenshot size"}, status_code=413)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > length:
                return JSONResponse({"error": "Screenshot exceeds declared size"}, status_code=413)
        if len(data) != length:
            return JSONResponse({"error": "Incomplete screenshot"}, status_code=400)
        try:
            filename = await run_in_threadpool(
                save_capture,
                directory,
                bytes(data),
                request.headers.get("x-phosphor-mode", "lines"),
            )
        except ValueError as error:
            return JSONResponse({"error": str(error)}, status_code=400)
        except OSError:
            LOGGER.exception(json.dumps({"event": "capture_failed"}))
            return JSONResponse({"error": "Could not save screenshot"}, status_code=500)
        return JSONResponse(
            {"filename": filename}, status_code=201, headers={"Cache-Control": "no-store"}
        )

    app.mount("/", StaticFiles(directory=directory, html=True), name="experiment")
    return app


def main() -> None:
    """Run the local screenshot-enabled server."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    LOGGER.info(
        json.dumps(
            {
                "event": "listening",
                "url": f"http://127.0.0.1:{args.port}",
                "capture_directory": str(PROGRAM_DIRECTORY),
            }
        )
    )
    uvicorn.run(
        create_app(port=args.port),
        host="127.0.0.1",
        port=args.port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
