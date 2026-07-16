"""
Minimal VoxCPM2 TTS server exposing the OpenAI-compatible `vllm-omni` contract
that OpenMAIC's VoxCPM adapter expects.

OpenMAIC calls:  POST {baseUrl}/v1/audio/speech
Body (JSON):
  {
    "model": "voxcpm2",
    "input": "(optional voice prompt)the text to speak",
    "voice": "default" | "<registered-voice-id>",
    "response_format": "wav",
    "stream": false,
    "ref_audio":   "data:audio/wav;base64,...",   # optional, voice cloning
    "prompt_audio":"data:audio/wav;base64,...",   # optional, prompt continuation
    "prompt_text": "reference transcript"          # optional (paired with prompt_audio)
  }
Returns: raw WAV bytes (Content-Type: audio/wav).

The leading "(...)" in `input` is VoxCPM's inline voice-description syntax; we pass
`input` through to the model as-is.

Run:
  PORT=8000 .venv/bin/python server.py
"""

import base64
import io
import os
import re
import threading

# GB10 (Blackwell, sm_121) + cu128 nvrtc: the JIT fuser emits an unsupported
# -arch and crashes ("invalid value for --gpu-architecture"). Run fused ops
# eagerly instead. Must be set before importing torch.
os.environ.setdefault("PYTORCH_JIT", "0")
os.environ.setdefault("PYTORCH_TENSOREXPR", "0")

import numpy as np
import soundfile as sf
import torch

# Belt-and-suspenders: keep the GPU/CPU fusers from nvrtc-compiling kernels.
for _fn, _arg in (
    ("_jit_set_profiling_executor", False),
    ("_jit_set_profiling_mode", False),
    ("_jit_override_can_fuse_on_gpu", False),
    ("_jit_override_can_fuse_on_cpu", False),
):
    try:
        getattr(torch._C, _fn)(_arg)
    except Exception:
        pass
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

MODEL_NAME = os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2")
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
# Denoiser (zipenhancer, from modelscope) is only needed to clean noisy reference
# audio for cloning; skip it for plain TTS to avoid an extra model download.
LOAD_DENOISER = os.environ.get("VOXCPM_LOAD_DENOISER", "0") == "1"

app = FastAPI(title="VoxCPM2 TTS (OpenMAIC vllm-omni shim)")

_model = None
_sr = 16000
_lock = threading.Lock()  # serialize inference (not guaranteed thread-safe)


def get_model():
    global _model, _sr
    if _model is None:
        with _lock:
            if _model is None:
                from voxcpm import VoxCPM

                device = "cuda" if torch.cuda.is_available() else "cpu"
                print(f"[voxcpm] loading {MODEL_NAME} on {device} (denoiser={LOAD_DENOISER}) ...", flush=True)
                m = VoxCPM.from_pretrained(
                    MODEL_NAME, load_denoiser=LOAD_DENOISER, device=device, optimize=False
                )
                try:
                    _sr = int(m.tts_model.sample_rate)
                except Exception:
                    _sr = 16000
                _model = m
                print(f"[voxcpm] ready (sample_rate={_sr})", flush=True)
    return _model


_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>.+)$", re.DOTALL)


def _decode_data_url_to_wav_path(data_url: str, tmp_name: str) -> str | None:
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        return None
    raw = base64.b64decode(m.group("data"))
    audio, sr = sf.read(io.BytesIO(raw), dtype="float32")
    path = f"/tmp/{tmp_name}.wav"
    sf.write(path, audio, sr)
    return path


class SpeechRequest(BaseModel):
    model: str | None = None
    input: str
    voice: str | None = "default"
    response_format: str | None = "wav"
    stream: bool | None = False
    ref_audio: str | None = None
    prompt_audio: str | None = None
    prompt_text: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "cuda": torch.cuda.is_available(), "sample_rate": _sr}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "voxcpm2", "object": "model"}]}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    text = (req.input or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is required")

    gen_kwargs = {"text": text}
    try:
        if req.prompt_audio and (req.prompt_text or "").strip():
            # Prompt-continuation cloning: prompt_wav_path + prompt_text.
            p = _decode_data_url_to_wav_path(req.prompt_audio, "voxcpm_prompt")
            if p:
                gen_kwargs["prompt_wav_path"] = p
                gen_kwargs["prompt_text"] = req.prompt_text.strip()
        elif req.ref_audio:
            # Reference cloning: reference_wav_path alone.
            p = _decode_data_url_to_wav_path(req.ref_audio, "voxcpm_ref")
            if p:
                gen_kwargs["reference_wav_path"] = p
    except Exception as e:
        print(f"[voxcpm] ref/prompt audio decode failed, plain TTS: {e}", flush=True)
        gen_kwargs = {"text": text}

    model = get_model()
    with _lock:
        wav = model.generate(**gen_kwargs)

    audio = np.asarray(wav, dtype=np.float32).squeeze()
    buf = io.BytesIO()
    sf.write(buf, audio, _sr, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    try:
        get_model()  # warm up so the first request isn't slow / racy
    except Exception as e:
        print(f"[voxcpm] WARNING: model preload failed: {e}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
