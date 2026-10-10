from __future__ import annotations

import importlib.util
import io
import logging
import os
import threading
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("pixpic.api")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(PROJECT_ROOT / "models"))).resolve()
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))
MAX_INPUT_SIDE = int(os.getenv("MAX_INPUT_SIDE", "6000"))
MAX_INPUT_PIXELS = int(os.getenv("MAX_INPUT_PIXELS", "24000000"))
MAX_OUTPUT_SIDE = int(os.getenv("MAX_OUTPUT_SIDE", "8192"))
MAX_OUTPUT_PIXELS = int(os.getenv("MAX_OUTPUT_PIXELS", "40000000"))
TILE_SIZE = int(os.getenv("REALESRGAN_TILE", "0"))
Image.MAX_IMAGE_PIXELS = MAX_INPUT_PIXELS


@dataclass(frozen=True)
class ModelSpec:
    key: str
    filename: str
    scale: int
    num_blocks: int


MODEL_SPECS = {
    "photo_2x": ModelSpec("photo_2x", "RealESRGAN_x2plus.pth", 2, 23),
    "photo_4x": ModelSpec("photo_4x", "RealESRGAN_x4plus.pth", 4, 23),
    "illustration_4x": ModelSpec("illustration_4x", "RealESRGAN_x4plus_anime_6B.pth", 4, 6),
}
SUPPORTED_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}
model_cache: dict[str, Any] = {}
inference_lock = threading.Lock()

app = FastAPI(
    title="PixPic Image Enhancement API",
    version="1.0.0",
    description=(
        "Real-ESRGAN image super-resolution. POST a JPG or PNG as multipart form data "
        "to /api/v1/enhance with scale=2|4 and mode=photo|illustration. "
        "Requires the matching local model weights; no resize fallback is provided."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Output-Width", "X-Output-Height", "X-Model", "X-Scale"],
)


def model_status(spec: ModelSpec) -> dict[str, Any]:
    missing: list[str] = []
    for module in ("torch", "basicsr", "realesrgan"):
        if importlib.util.find_spec(module) is None:
            missing.append(module)
    if missing:
        return {"ready": False, "reason": f"Install model dependencies: {', '.join(missing)}."}

    weight_path = MODEL_DIR / spec.filename
    if not weight_path.is_file():
        return {"ready": False, "reason": f"Model weights are missing: {spec.filename}."}
    return {"ready": True}


def decode_image(data: bytes, content_type: str | None) -> Image.Image:
    """Validate the declared MIME type and safely decode an in-memory JPG or PNG."""
    expected_format = SUPPORTED_FORMATS.get((content_type or "").split(";")[0].strip().lower())
    if expected_format is None:
        raise ValueError("Choose a JPG or PNG image.")
    if not data:
        raise ValueError("The uploaded file is empty.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as opened:
                if opened.format != expected_format:
                    raise ValueError("The file contents do not match the declared image type.")
                width, height = opened.size
                if width < 1 or height < 1:
                    raise ValueError("The image dimensions are invalid.")
                if width > MAX_INPUT_SIDE or height > MAX_INPUT_SIDE:
                    raise ValueError(f"Image dimensions must not exceed {MAX_INPUT_SIDE} px on either side.")
                if width * height > MAX_INPUT_PIXELS:
                    raise ValueError("The image has too many pixels to process.")
                opened.load()
                oriented = ImageOps.exif_transpose(opened)
                return oriented.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("The image could not be decoded safely. Try another JPG or PNG.") from exc


def output_size_error(width: int, height: int, scale: int) -> str | None:
    output_width = width * scale
    output_height = height * scale
    if output_width > MAX_OUTPUT_SIDE or output_height > MAX_OUTPUT_SIDE:
        return f"At {scale}×, the output would exceed the {MAX_OUTPUT_SIDE} px side limit."
    if output_width * output_height > MAX_OUTPUT_PIXELS:
        return f"At {scale}×, the output would exceed the {MAX_OUTPUT_PIXELS:,}-pixel processing limit."
    return None


def load_enhancer(spec: ModelSpec) -> Any:
    if spec.key in model_cache:
        return model_cache[spec.key]

    weight_path = MODEL_DIR / spec.filename
    if not weight_path.is_file():
        raise RuntimeError(f"Model weights are not installed: {spec.filename}.")

    try:
        import torch
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
    except Exception as exc:
        raise RuntimeError(
            "Real-ESRGAN dependencies are unavailable or incompatible. See the backend setup guide."
        ) from exc

    network = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=spec.num_blocks,
        num_grow_ch=32,
        scale=spec.scale,
    )
    use_cuda = torch.cuda.is_available()
    enhancer = RealESRGANer(
        scale=spec.scale,
        model_path=str(weight_path),
        model=network,
        tile=TILE_SIZE,
        tile_pad=10,
        pre_pad=0,
        half=use_cuda,
        device=torch.device("cuda" if use_cuda else "cpu"),
    )
    model_cache[spec.key] = enhancer
    return enhancer


def run_inference(image: Image.Image, spec: ModelSpec) -> tuple[bytes, int, int]:
    import numpy as np

    try:
        with inference_lock:
            enhancer = load_enhancer(spec)
            source = np.asarray(image)[:, :, ::-1]
            output_bgr, _ = enhancer.enhance(source, outscale=spec.scale)
            output_rgb = np.ascontiguousarray(output_bgr[:, :, ::-1])
            result = Image.fromarray(output_rgb, mode="RGB")
            output = io.BytesIO()
            result.save(output, format="PNG", optimize=True)
            return output.getvalue(), result.width, result.height
    except RuntimeError:
        raise
    except Exception as exc:
        logger.exception("Real-ESRGAN inference failed")
        raise RuntimeError("AI enhancement failed. Check backend logs and available memory, then retry.") from exc


@app.get("/health", tags=["service"])
def health() -> dict[str, Any]:
    statuses = {key: model_status(spec) for key, spec in MODEL_SPECS.items()}
    return {
        "status": "ok",
        "inference_available": any(item["ready"] for item in statuses.values()),
        "models": statuses,
    }


@app.post(
    "/api/v1/enhance",
    tags=["enhancement"],
    summary="Enhance an image with Real-ESRGAN",
    responses={
        200: {"description": "Processed PNG with output dimensions in response headers."},
        413: {"description": "Upload exceeds the configured byte limit."},
        422: {"description": "Unsupported, malformed, or too-large image."},
        503: {"description": "Requested model dependencies or weights are unavailable."},
    },
)
async def enhance(
    file: UploadFile = File(..., description="JPG or PNG image, up to the configured upload limit"),
    scale: int = Form(..., description="Output scale: 2 or 4"),
    mode: str = Form("photo", description="photo or illustration"),
) -> StreamingResponse:
    if scale not in (2, 4):
        raise HTTPException(status_code=422, detail="Scale must be 2 or 4.")
    if mode not in ("photo", "illustration"):
        raise HTTPException(status_code=422, detail="Mode must be photo or illustration.")
    if mode == "illustration" and scale != 4:
        raise HTTPException(status_code=422, detail="The illustration model supports 4× output only.")

    model_key = f"photo_{scale}x" if mode == "photo" else "illustration_4x"
    spec = MODEL_SPECS[model_key]
    status = model_status(spec)
    if not status["ready"]:
        raise HTTPException(status_code=503, detail=status["reason"])

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image uploads are limited to {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        image = decode_image(data, file.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()

    size_error = output_size_error(image.width, image.height, scale)
    if size_error:
        raise HTTPException(status_code=422, detail=size_error)

    try:
        output, width, height = await run_in_threadpool(run_inference, image, spec)
    except RuntimeError as exc:
        logger.warning("Requested model unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    headers = {
        "X-Output-Width": str(width),
        "X-Output-Height": str(height),
        "X-Model": spec.filename.removesuffix(".pth"),
        "X-Scale": str(scale),
        "Cache-Control": "no-store",
    }
    return StreamingResponse(io.BytesIO(output), media_type="image/png", headers=headers)
