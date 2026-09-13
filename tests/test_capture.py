"""Exercise capture input through HTTP and read back the exact saved PNG."""

import struct
import tempfile
import unittest
import zlib
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from phosphor.server import MAX_CAPTURE_BYTES, PNG_SIGNATURE, create_app, main, validate_png


def png_chunk(kind, payload):
    """Create deterministic fixture chunks with real PNG checksums."""
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload))
    )


PNG = (
    PNG_SIGNATURE
    + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    + png_chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    + png_chunk(b"IEND", b"")
)


@contextmanager
def running_server():
    """Exercise the ASGI HTTP interface in an isolated output directory."""
    with (
        tempfile.TemporaryDirectory() as directory,
        TestClient(create_app(Path(directory)), base_url="http://127.0.0.1:8000") as client,
    ):
        yield client, Path(directory)


class CaptureTests(unittest.TestCase):
    """Valid captures roundtrip; invalid requests cannot create files."""

    def request(self, server, data=PNG, extra=None, path="/__capture"):
        """Submit a capture with the headers sent by the browser."""
        headers = {
            "Origin": "http://127.0.0.1:8000",
            "Content-Type": "image/png",
            "X-Phosphor-Capture": "1",
            "X-Phosphor-Mode": "mandelbrot",
        }
        headers.update(extra or {})
        response = server.post(path, content=data, headers=headers)
        return response.status_code, response.json()

    def test_saved_capture_roundtrips_and_has_unique_filename(self):
        """Two presses create distinct files retrievable through the server."""
        with running_server() as (server, directory):
            names = []
            for _ in range(2):
                status, body = self.request(server)
                self.assertEqual(status, 201)
                name = body["filename"]
                self.assertTrue(name.startswith("phosphor-mandelbrot-"))
                self.assertEqual((directory / name).read_bytes(), PNG)
                names.append(name)
            self.assertNotEqual(names[0], names[1])
            response = server.get("/" + names[0])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, PNG)

    def test_rejected_requests_do_not_write_files(self):
        """Reject other origins, hostile hosts, invalid formats, and oversized bodies."""
        cases = [
            ({"Origin": "https://example.com"}, 403, PNG),
            ({"Host": "evil.example"}, 403, PNG),
            ({"X-Phosphor-Capture": ""}, 403, PNG),
            ({"Content-Type": "text/plain"}, 415, PNG),
            ({"Content-Length": str(MAX_CAPTURE_BYTES + 1)}, 413, PNG),
            ({"Content-Length": "not-a-number"}, 413, PNG),
            ({"Content-Length": "1"}, 413, PNG),
            ({"Content-Length": str(len(PNG) + 1)}, 400, PNG),
            ({}, 400, b"not png"),
            ({}, 400, PNG[:-1]),
        ]
        with running_server() as (server, directory):
            for headers, expected, data in cases:
                with self.subTest(headers=headers, data=data[:8]):
                    status, _ = self.request(server, data, headers)
                    self.assertEqual(status, expected)
            self.assertEqual(list(directory.iterdir()), [])

    def test_unknown_action_and_unsafe_mode(self):
        """Client input cannot choose a path or an arbitrary filename."""
        with running_server() as (server, directory):
            status, _ = self.request(server, path="/elsewhere")
            self.assertEqual(status, 405)
            status, body = self.request(server, extra={"X-Phosphor-Mode": "../../outside"})
            self.assertEqual(status, 201)
            self.assertTrue(body["filename"].startswith("phosphor-display-"))
            self.assertEqual(len(list(directory.iterdir())), 1)

    def test_disk_failure_is_reported(self):
        """A failed write is not reported as a successful screenshot."""
        with running_server() as (server, _):
            with patch("phosphor.server.Path.open", side_effect=OSError("fixture disk failure")):
                status, body = self.request(server)
            self.assertEqual(status, 500)
            self.assertIn("Could not save", body["error"])

    def test_png_validation(self):
        """Reject corrupt checksums, malformed chunks, and missing image data."""
        validate_png(PNG)
        header = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        end = png_chunk(b"IEND", b"")
        invalid = [
            PNG[:20],
            PNG[:-1] + b"x",
            PNG + b"trailing",
            PNG_SIGNATURE,
            PNG_SIGNATURE + end,
            PNG_SIGNATURE + header + header + end,
            PNG_SIGNATURE + header + end,
            PNG_SIGNATURE + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 0, 1, 8, 2, 0, 0, 0)) + end,
        ]
        for data in invalid:
            with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                validate_png(data)

    def test_cli_binds_only_loopback_with_requested_port(self):
        """The runnable CLI starts the screenshot app on the requested local port."""
        with (
            patch("sys.argv", ["phosphor", "--port", "8123"]),
            patch("phosphor.server.uvicorn.run") as run,
        ):
            main()
        self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
        self.assertEqual(run.call_args.kwargs["port"], 8123)


if __name__ == "__main__":
    unittest.main()
