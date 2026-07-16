# VoxCPM2 TTS server, containerized. Needs the NVIDIA Container Toolkit on the
# host + `--gpus`/compose GPU reservation at run time (no CUDA toolkit baked
# into the base image — the pip-installed torch wheel bundles its own CUDA
# runtime libs, it only needs the host's driver + nvidia-container-toolkit).
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsndfile1 curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu128 \
  && pip install --no-cache-dir numpy soundfile fastapi uvicorn voxcpm \
  && pip install --no-cache-dir --force-reinstall torchaudio --index-url https://download.pytorch.org/whl/cu128

COPY server.py .

ENV PYTORCH_JIT=0
ENV PYTORCH_TENSOREXPR=0
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=300s --retries=10 \
  CMD curl -sf http://localhost:8000/health || exit 1

CMD ["python", "server.py"]
