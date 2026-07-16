# VoxCPM2 TTS server, containerized. Needs the NVIDIA Container Toolkit on the
# host + `--gpus`/compose GPU reservation at run time (no CUDA toolkit baked
# into the base image — the pip-installed torch wheel bundles its own CUDA
# runtime libs, it only needs the host's driver + nvidia-container-toolkit).
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsndfile1 curl \
  && rm -rf /var/lib/apt/lists/*

# PIP_DEFAULT_TIMEOUT: the CUDA wheels below are 300-900MB each; pip's default
# 15s read timeout is too short for a slow/inconsistent connection and causes
# spurious mid-download failures. Each pip call is its own layer so a retry
# after a transient failure doesn't have to re-download ones that already
# succeeded.
ENV PIP_DEFAULT_TIMEOUT=180
RUN pip install --no-cache-dir --retries 10 torch --index-url https://download.pytorch.org/whl/cu128
RUN pip install --no-cache-dir --retries 10 numpy soundfile fastapi uvicorn voxcpm
RUN pip install --no-cache-dir --retries 10 --force-reinstall torchaudio --index-url https://download.pytorch.org/whl/cu128

COPY server.py .

ENV PYTORCH_JIT=0
ENV PYTORCH_TENSOREXPR=0
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=10 \
  CMD curl -sf http://localhost:8000/health || exit 1

CMD ["python", "server.py"]
