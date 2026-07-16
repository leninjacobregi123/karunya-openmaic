# Local VoxCPM2 TTS server (dev)

A minimal FastAPI shim that serves **VoxCPM2** (OpenBMB) behind the OpenAI-compatible
`POST /v1/audio/speech` contract that OpenMAIC's VoxCPM adapter (`vllm-omni` backend)
expects. Runs on the GB10 host GPU; the OpenMAIC dev container reaches it over host
networking.

## Run

```bash
cd deploy/tts-voxcpm
./start.sh            # detached, logs -> server.log
curl localhost:8000/health
./stop.sh             # stop
```

OpenMAIC is wired via `TTS_VOXCPM_BASE_URL=http://localhost:8000/v1` in
`docker-compose.dev.yml` (server-managed provider → keys/URL hidden from clients).

## How it was set up (reproduce)

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch      --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/bin/python numpy soundfile fastapi uvicorn voxcpm
# voxcpm pulls a mismatched torchaudio; pin it to cu128:
uv pip install --python .venv/bin/python --reinstall-package torchaudio torchaudio \
    --index-url https://download.pytorch.org/whl/cu128
```

## GB10 / Blackwell notes (important)

- Host is **arm64 (sbsa)**, GPU **NVIDIA GB10**, compute capability **sm_121**, driver 580, CUDA 13 host toolkit.
- Working stack: **torch 2.11.0+cu128 / torchaudio 2.11.0+cu128** — CUDA verified (`torch.cuda.is_available()` True, GPU matmul OK).
- **`PYTORCH_JIT=0` is required.** With the JIT fuser on, the cu128 nvrtc rejects sm_121
  (`nvrtc: invalid value for --gpu-architecture`) when compiling fused kernels (VoxCPM's
  "snake" activation). Running eager avoids it. `start.sh` sets this.
- Model loads on `cuda` with `optimize=False`, denoiser disabled (no modelscope download).
- Output sample rate: **48 kHz**.

## Contract served

`POST /v1/audio/speech` — `{model, input, voice, response_format, ref_audio?, prompt_audio?, prompt_text?}` → WAV bytes.
`input` may carry VoxCPM's inline `(voice description)text` syntax. `ref_audio`/`prompt_audio`
are `data:` URLs for voice cloning. Also exposes `GET /health` and `GET /v1/models`.

## Status / follow-ups

- Validated: direct synth + full path through OpenMAIC `POST /api/generate/tts` (returns WAV).
- Playback narration (auto voice) is synthesized **client-side on demand** using each agent's
  persona → voice prompt. For the **publish-immutable** architecture we still need
  **server-side pre-generation** at publish time (OpenMAIC currently *skips* server-side TTS
  when the voice is `voxcpm:auto` — needs a small change to pass agent voiceDesign).
- This dev server is a host process. For K8s it gets containerized (Phase 0) — revisit the
  cu128/sm_121 JIT workaround for the target cluster's GPUs/toolkit.
