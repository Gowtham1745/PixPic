# PixPic

PixPic is a React, TypeScript, and Vite image-upscaling interface backed by a FastAPI service. The backend uses the open-source Real-ESRGAN models for actual super-resolution. The frontend never substitutes ordinary resizing for model inference: when the API or requested model is unavailable, it shows an error instead of claiming success.

## What works

- Responsive upload and comparison interface, JPG/PNG validation, image preview, scale and model selection, error/retry states, and PNG download.
- FastAPI health check and documented `/docs` endpoint.
- Real-ESRGAN 2×/4× photo models and the 4× anime/illustration model when their dependencies and weights are installed.
- GitHub Pages frontend deployment through Actions. Pages is static hosting; Python inference must run as a separately deployed API.

## Frontend setup

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
cd C:\Gowtham_Prince\Gowtham_CODE\PixPic
Copy-Item .env.example .env
npm ci
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. For a frontend-only preview, image selection and validation work, but Enhance reports that the AI service is unavailable until the backend is running.

Optional `.env` settings:

- `VITE_API_BASE_URL`: deployed FastAPI origin, for example `https://pixpic-api.example.com`; leave blank for the local Vite proxy.
- `VITE_BASE_PATH`: local default `/`; the Pages workflow supplies `/<actual-repository-name>/` at build time.
- `VITE_GITHUB_REPOSITORY_URL`: optional public repository URL for the footer. The workflow derives it from GitHub Actions.

Useful checks:

```powershell
npm run lint
npm run build
npm run preview
```

## FastAPI backend (Windows PowerShell)

Use Python 3.10 or 3.11. PyTorch wheels depend on your Python version, operating system, and CUDA version; install the matching `torch` and `torchvision` pair from the official PyTorch install selector before the model package. The CPU command below is suitable for getting started on Windows:

```powershell
cd C:\Gowtham_Prince\Gowtham_CODE\PixPic\backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-model.txt
.\download_models.ps1
$env:CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal, then activate the environment. Browse to `http://127.0.0.1:8000/health` for model readiness and `http://127.0.0.1:8000/docs` for the interactive API documentation. Vite proxies `/api` and `/health` to this local service.

The downloadable weights are official Real-ESRGAN release files and are intentionally excluded from Git. The API loads a selected model on its first request and caches it in memory. CPU inference is supported but can be slow; a compatible NVIDIA GPU is recommended for throughput. Set `REALESRGAN_TILE=256` (or lower) to reduce GPU memory usage at the cost of speed. The Docker image is CPU-oriented and large because it includes PyTorch and model weights; for production, use a GPU-capable container host and persistent model storage where practical.

### API contract

`POST /api/v1/enhance` accepts multipart fields `file` (JPG/PNG), `scale` (`2` or `4`), and `mode` (`photo` or `illustration`). It returns the actual enhanced PNG and `X-Output-Width`, `X-Output-Height`, `X-Model`, and `X-Scale` headers. Invalid files and resource limits return `422`/`413`; missing model setup returns `503`. `GET /health` reports per-model readiness. Uploads are decoded and processed in memory and are not written to disk or retained by this application.

Limits and CORS origins are configurable with `MAX_UPLOAD_BYTES`, `MAX_INPUT_SIDE`, `MAX_INPUT_PIXELS`, `MAX_OUTPUT_SIDE`, `MAX_OUTPUT_PIXELS`, `MODEL_DIR`, `REALESRGAN_TILE`, and `CORS_ORIGINS`. Include the exact deployed frontend origin in `CORS_ORIGINS`, for example `https://your-user.github.io`; do not use `*` for a credentialed production service. HTTPS and any rate limiting/authentication should be handled by the API host or its reverse proxy.

### Backend tests

With the backend environment active:

```powershell
python -m pip install -r requirements.txt
python -m pytest
```

These tests cover safe image decoding, MIME validation, output limits, and API input rejection without requiring model weights. A real inference smoke test requires the model dependencies and weights above.

## GitHub Pages deployment

1. Push the project to a GitHub repository whose default branch is `main` (or update `.github/workflows/deploy-pages.yml` to match).
2. In **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
3. Optionally add the repository Actions variable `VITE_API_BASE_URL` containing the public HTTPS origin of a separately deployed FastAPI backend. Add that frontend origin to the backend's `CORS_ORIGINS`.
4. Push to `main` or manually run **Deploy PixPic to GitHub Pages** from the Actions tab. The workflow builds with the actual repository name as Vite's base path.

The public URL is normally `https://<owner>.github.io/<repository>/` for a project site. This repository has no Git remote configured yet, so deployment cannot be run or verified from this workspace. Do not use GitHub Pages for the Python API.

## Deploying the backend separately

`backend/Dockerfile` builds a CPU-oriented image with the pinned model files and exposes port `8000`. From the repository root, build and run it with Docker:

```powershell
docker build -f backend/Dockerfile -t pixpic-api ./backend
docker run --rm -p 8000:8000 -e CORS_ORIGINS=https://<owner>.github.io pixpic-api
```

Publish that image to a container host (GPU-capable hosting is preferred for interactive inference), configure `CORS_ORIGINS` for the deployed Pages origin, and set the resulting HTTPS API origin as the GitHub Actions variable `VITE_API_BASE_URL`. Keep model weights on a mounted volume if the host rebuilds containers frequently; point `MODEL_DIR` at that volume. Do not put API secrets in the Vite environment: frontend variables are public at build time.

## Model and inference limitations

Real-ESRGAN reconstructs plausible detail; it cannot recover the exact original scene information absent from a low-resolution source. The photo 2×, photo 4×, and illustration 4× models are separate weights. The illustration model only supports 4×. Large requested outputs are rejected using configurable side and pixel limits to control memory use. Enhancement quality and speed depend on the model, source image, available RAM/VRAM, and host. PixPic does not call a paid third-party inference API; inference runs on the backend you deploy.
