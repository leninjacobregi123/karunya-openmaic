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

# PIP_DEFAULT_TIMEOUT: the CUDA wheels below are 300-900MB each; pip's default
# 15s read timeout is too short for a slow/inconsistent connection and causes
# spurious mid-download failures. Each pip call is its own layer so a retry
# after a transient failure doesn't have to re-download ones that already
# succeeded.
ENV PIP_DEFAULT_TIMEOUT=180
RUN pip install --no-cache-dir --retries 10 torch --index-url https://download.pytorch.org/whl/cu128
# torch's Linux wheel unconditionally declares triton as a dependency (for
# torch.compile), but nothing in this server calls torch.compile - it's dead
# weight, and on some Blackwell consumer cards (e.g. RTX 5090) the triton
# version torch pins doesn't have working kernels yet. Remove it; eager-mode
# inference (what we actually use, PYTORCH_JIT=0 below) doesn't need it.
RUN pip uninstall -y triton
RUN pip install --no-cache-dir --retries 10 diffusers transformers accelerate safetensors pillow sentencepiece fastapi uvicorn

COPY server.py .

ENV PYTORCH_JIT=0
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=10 \
  CMD curl -sf http://localhost:8001/health || exit 1

CMD ["python", "server.py"]
