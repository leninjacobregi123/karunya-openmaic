# SDXL image-gen server, containerized. Needs the NVIDIA Container Toolkit on
# the host + `--gpus`/compose GPU reservation at run time (same rationale as
# deploy/tts-voxcpm/Dockerfile - no CUDA toolkit baked in, just the driver).
#
# server.py auto-detects VRAM at load time: >=8GB -> bf16, whole pipeline
# resident on GPU (fast); <8GB -> fp16 + sequential CPU offload + a numerically
# rescaled VAE (avoids the fp16-VAE black-image bug), much slower but fits.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu128 \
  && pip install --no-cache-dir diffusers transformers accelerate safetensors pillow sentencepiece fastapi uvicorn

COPY server.py .

ENV PYTORCH_JIT=0
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=10 \
  CMD curl -sf http://localhost:8001/health || exit 1

CMD ["python", "server.py"]
