from __future__ import annotations

import io

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app, decode_image, output_size_error

client = TestClient(app)


def make_png(width: int = 32, height: int = 24) -> bytes:
    image = Image.new("RGB", (width, height), color=(44, 120, 88))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_decodes_valid_png_in_memory() -> None:
    image = decode_image(make_png(), "image/png")
    assert image.size == (32, 24)
    assert image.mode == "RGB"


def test_rejects_mismatched_mime_type() -> None:
    with pytest.raises(ValueError, match="do not match"):
        decode_image(make_png(), "image/jpeg")


def test_rejects_unsupported_mime_type() -> None:
    with pytest.raises(ValueError, match="JPG or PNG"):
        decode_image(make_png(), "image/webp")


def test_rejects_corrupt_image_data() -> None:
    with pytest.raises(ValueError, match="could not be decoded"):
        decode_image(b"not an image", "image/png")


def test_enforces_upscaled_output_limits() -> None:
    assert output_size_error(100, 100, 4) is None
    assert output_size_error(3000, 3000, 4) is not None


def test_api_rejects_invalid_scale_before_inference() -> None:
    response = client.post(
        "/api/v1/enhance",
        files={"file": ("test.png", make_png(), "image/png")},
        data={"scale": "3", "mode": "photo"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Scale must be 2 or 4."
