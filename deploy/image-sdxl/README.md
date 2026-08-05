# Local SDXL image server (dev)

A minimal FastAPI server that serves **Stable Diffusion XL** (diffusers) behind the
OpenAI-compatible `/v1/images/generations` contract that OpenMAIC's **`lemonade`**
image provider uses. Runs on the GB10 host GPU; the OpenMAIC dev container reaches it
over host networking.

## Run

```bash
cd deploy/image-sdxl
./start.sh            # detached, logs -> server.log
curl localhost:8001/health
./stop.sh
```

This host-process path is a standalone alternative for iterating on the server
outside Docker. The actual deployed path containerizes this same `server.py` via
the sibling `Dockerfile` and runs it as the `image` service in
`docker-compose.remote.yml` (gated behind the `media` Compose profile, with
`IMAGE_LOW_VRAM=1` set to let it coexist with a large resident LLM — see
`CLAUDE.md`'s Karunya customization section for the current bring-up flow).
Because `lemonade` is keyless and we do **not** set `IMAGE_OPENAI_API_KEY`, it
becomes the server-managed default image provider for classroom generation.

## Reproduce the env

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/bin/python diffusers transformers accelerate safetensors pillow sentencepiece fastapi uvicorn
```

Working stack: torch 2.11.0+cu128, diffusers 0.38.0, transformers 5.12.1.

## Contract served

- `POST /v1/images/generations` — `{model, prompt, n, size:"WxH", response_format}` → `{data:[{b64_json}]}` (PNG).
- `GET /v1/models`, `GET /health` — 200 connectivity checks.

OpenMAIC requests ≤1024px (16:9 → 1024×576, 4:3 → 1024×768, 1:1 → 1024×1024); `model` is arbitrary and ignored.

## Notes

- Model: `stabilityai/stable-diffusion-xl-base-1.0`, **bf16** (Blackwell-native; avoids the SDXL fp16-VAE black-image bug), 30 steps, guidance 5.0. Tune via env `IMAGE_STEPS`, `IMAGE_GUIDANCE`, `IMAGE_MODEL`.
- `PYTORCH_JIT=0` set defensively (same GB10/sm_121 + cu128 nvrtc caveat as the TTS server).
- ~37s per 1024×576 image (30 steps) incl. first-run warmup; faster afterwards. For lower latency consider SDXL-Turbo / fewer steps.
- Validated: direct generation (valid PNG) + as OpenMAIC's server-managed image provider.
- Now also containerized (see `Dockerfile` + the `image` service in
  `docker-compose.remote.yml`) — this `start.sh`/`stop.sh` host-process path remains
  as a standalone option for iterating without Docker.
