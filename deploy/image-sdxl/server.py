"""
Minimal local image-generation server exposing the OpenAI-compatible
`/v1/images/generations` contract that OpenMAIC's `lemonade` image provider uses.

OpenMAIC calls:
  GET  {baseUrl}/v1/models                 (connectivity check; any 200 JSON)
  POST {baseUrl}/v1/images/generations
       { "model": "<any>", "prompt": "...", "n": 1,
         "size": "1024x576", "response_format": "b64_json" }
  -> { "data": [ { "b64_json": "<base64 PNG>" } ] }

Backed by Stable Diffusion XL (diffusers) on the GB10 GPU.

Run:
  PORT=8001 .venv/bin/python server.py
"""

import base64
import io
import os
import threading

# GB10 (Blackwell sm_121) + cu128: keep the JIT fuser from nvrtc-compiling for an
# unsupported arch. diffusers runs eager anyway; this is defensive.
os.environ.setdefault("PYTORCH_JIT", "0")

import torch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

MODEL_NAME = os.environ.get("IMAGE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")
PORT = int(os.environ.get("PORT", "8001"))
HOST = os.environ.get("HOST", "0.0.0.0")
STEPS = int(os.environ.get("IMAGE_STEPS", "30"))
GUIDANCE = float(os.environ.get("IMAGE_GUIDANCE", "5.0"))

app = FastAPI(title="SDXL image server (OpenMAIC lemonade-compatible)")

_pipe = None
_lock = threading.Lock()


def _resolve_local(repo_id: str) -> str:
    # diffusers' from_pretrained(repo_id, variant=...) needs to consult the Hub API to
    # figure out which variant files exist, EVEN when HF_HUB_OFFLINE=1 and everything is
    # already cached (a cache populated by our own snapshot_download rather than by
    # diffusers itself isn't trusted the same way) - it fails with "model is not cached
    # locally" despite the files being right there. Resolving to the concrete local
    # snapshot directory first sidesteps that: diffusers treats a filesystem path as a
    # pure local load with no Hub/variant/network resolution at all.
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(repo_id=repo_id, local_files_only=True)
    except Exception:
        # Not cached (or only partially) - fall back to the repo id so the normal
        # online download path (dev flow: first-request download) still works.
        return repo_id


def get_pipe():
    global _pipe
    if _pipe is None:
        with _lock:
            if _pipe is None:
                from diffusers import StableDiffusionXLPipeline

                device = "cuda" if torch.cuda.is_available() else "cpu"
                # bf16 avoids the SDXL fp16-VAE NaN/black-image bug on Blackwell, but this
                # host is a 4GB Turing card (no bf16 tensor cores, and no headroom to keep
                # the full ~7GB pipeline resident) -> fp16 + CPU offload instead.
                low_vram = device == "cuda" and torch.cuda.get_device_properties(0).total_memory < 8 * 1024**3
                dtype = torch.float16 if (device == "cuda" and low_vram) else (
                    torch.bfloat16 if device == "cuda" else torch.float32
                )
                print(f"[sdxl] loading {MODEL_NAME} on {device} ({dtype}, low_vram={low_vram}) ...", flush=True)
                vae = None
                if low_vram:
                    # The stock SDXL VAE overflows to NaN in fp16 (decodes to a solid black
                    # image) -- this community VAE is numerically rescaled to be fp16-safe.
                    from diffusers import AutoencoderKL

                    vae = AutoencoderKL.from_pretrained(
                        _resolve_local("madebyollin/sdxl-vae-fp16-fix"), torch_dtype=dtype
                    )
                pipe = StableDiffusionXLPipeline.from_pretrained(
                    _resolve_local(MODEL_NAME), torch_dtype=dtype, use_safetensors=True, variant="fp16",
                    **({"vae": vae} if vae is not None else {}),
                )
                if low_vram:
                    # Model-level offload still stages a whole submodule (the UNet alone is
                    # ~5GB in fp16) onto the GPU at once, which doesn't fit in ~3.6GB usable
                    # VRAM. Sequential offload moves individual layers instead -> much lower
                    # peak memory, much slower.
                    pipe.enable_sequential_cpu_offload()
                    pipe.enable_vae_slicing()
                    pipe.enable_attention_slicing()
                else:
                    pipe = pipe.to(device)
                pipe.set_progress_bar_config(disable=True)
                _pipe = pipe
                print("[sdxl] ready", flush=True)
    return _pipe


def _parse_size(size: str | None) -> tuple[int, int]:
    w, h = 1024, 1024
    if size and "x" in size.lower():
        try:
            a, b = size.lower().split("x", 1)
            w, h = int(a), int(b)
        except Exception:
            w, h = 1024, 1024
    # SDXL needs multiples of 8; clamp to a sane range.
    clamp = lambda v: max(512, min(1024, (int(v) // 8) * 8))
    return clamp(w), clamp(h)


class ImageRequest(BaseModel):
    model: str | None = None
    prompt: str
    n: int | None = 1
    size: str | None = "1024x1024"
    response_format: str | None = "b64_json"


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "cuda": torch.cuda.is_available()}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "sdxl", "object": "model"}]}


@app.post("/v1/images/generations")
def generate(req: ImageRequest):
    prompt = (req.prompt or "").strip()
    if not prompt:
        return JSONResponse(status_code=400, content={"error": "prompt is required"})
    width, height = _parse_size(req.size)
    n = max(1, min(int(req.n or 1), 4))

    pipe = get_pipe()
    out = []
    with _lock:
        for _ in range(n):
            image = pipe(
                prompt=prompt,
                width=width,
                height=height,
                num_inference_steps=STEPS,
                guidance_scale=GUIDANCE,
            ).images[0]
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            out.append({"b64_json": base64.b64encode(buf.getvalue()).decode("ascii")})
    return {"created": 0, "data": out}


if __name__ == "__main__":
    import uvicorn

    try:
        get_pipe()  # warm up so the first request isn't slow / racy
    except Exception as e:
        print(f"[sdxl] WARNING: model preload failed: {e}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
