# karunya-openmaic

A multi-tenant learning management system for Karunya University: real accounts, roles,
courses, cohorts, and progress tracking, layered on top of
[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) — an open-source, multi-agent AI
classroom generator that turns a topic or document into an interactive, narrated,
illustrated lesson.

Upstream OpenMAIC is single-user and browser-local. This fork adds a real server-side
platform on top of it — auth/RBAC, a Postgres-backed course catalog with immutable
publishing, cohort enrollment, per-student progress and transcripts, and a teacher
dashboard — while keeping the platform additions in separate modules so upstream merges
stay clean. All AI generation (text, speech, images) runs against **local, self-hosted
models** — no third-party AI API keys required or used.

## Architecture at a glance

- **`OpenMAIC/`** — the application (Next.js/React/TypeScript). Course generation
  (topic → outline → scenes), a LangGraph-driven multi-agent playback engine, and a
  canvas-based slide renderer. See [`OpenMAIC/README.md`](OpenMAIC/README.md) for the
  app's own internals.
- **Platform layer** (added on top, inside `OpenMAIC/lib/`) — Postgres/Drizzle for
  users, courses, cohorts, enrollment, and progress; Redis for sessions and job state;
  MinIO (S3-compatible) for generated media; HMAC session auth with pluggable
  identity providers (dev accounts today, LDAP/AD designed for production).
- **Model serving** — vLLM (text), VoxCPM2 (text-to-speech), and Stable Diffusion XL
  (images), each containerized and served over an OpenAI-compatible API. See
  [Local LLM Configuration](#local-llm-configuration) below.

Full design doc (data model, auth design, course lifecycle, Kubernetes scale-up path):
[`docs/karunya-architecture.md`](docs/karunya-architecture.md).

## Prerequisites

The whole stack is containerized — the only host-level requirements are:

- Docker Engine + the Docker Compose plugin
- An NVIDIA GPU with **≥32GB VRAM**, the NVIDIA driver, and the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  configured for Docker (`nvidia-ctk runtime configure --runtime=docker && systemctl restart docker`).
  Verify with:
  ```bash
  docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
  ```
  (No GPU on this host? Point at an external OpenAI-compatible LLM server instead —
  see [Local LLM Configuration](#local-llm-configuration).)

## Deploy

```bash
git clone <this-repo-url> && cd karunya-openmaic
docker compose -f docker-compose.remote.yml up -d --build
```

That's the entire deployment — one command, nothing to configure first. The committed
`.env` ships ready-to-run dev secrets and model configuration; model weights are
fetched automatically by one-shot init containers before the LLM/TTS/image services
start (from pre-packaged GitHub Releases, since this doesn't require the deploy host to
reach Hugging Face directly), and that step is skipped on every subsequent `up` once the
cache is populated.

```bash
docker compose -f docker-compose.remote.yml logs -f vllm   # first boot: downloads + loads the ~18GB model
docker compose -f docker-compose.remote.yml logs -f app
```

Once `app` is healthy, open `http://<this-host>:3000`.

> **Before this host is reachable by anyone but you:** replace every value in `.env`
> with your own (it ships fixed dev-grade secrets for zero-setup convenience — see
> [Going to production](#going-to-production)).

## Configuration

Everything is set via the root `.env` file (auto-loaded by Docker Compose;
`.env.remote.example` documents every value if you want to build your own from
scratch). The values that matter:

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `SESSION_SECRET` | Secrets — **replace before any real deployment**. |
| `MAIC_SEED_DEV_USERS` | `true` seeds demo accounts (see below); set `false` once real auth is wired up. |
| `MAIC_VLLM_MODEL`, `MAIC_VLLM_BASE_URL` | Which model the app talks to and where — see below. |
| `COMPOSE_PROFILES` | `local-vllm` (default) runs the containerized LLM; add `,media` to also run TTS/image by default. |
| `MAIC_APP_PORT`, `MAIC_MINIO_CONSOLE_PORT` | Host-side port mappings. |

## Local LLM Configuration

This is the part most likely to need tuning for a different GPU/host, so it's
documented in full.

**What's running today:** [vLLM](https://github.com/vllm-project/vllm) (v0.10.1)
serving **`Qwen/Qwen3-32B-AWQ`** — a 32B-parameter dense model, int4-quantized (AWQ),
~18GB of weights — as an OpenAI-compatible API. It's the `vllm` service in
`docker-compose.remote.yml`, enabled by default via the `local-vllm` Compose profile.

**Why this model:** it's the largest/highest-quality model that fits on a single 32GB
GPU *alongside* the TTS and image-generation services the app also needs at generation
time — see the sizing breakdown below. On a host with more/bigger GPUs, swap in a
larger model (e.g. a 70B-class instruct model) with no application code changes —
purely a `MAIC_VLLM_MODEL` + resource/tuning change (see [`docs/karunya-architecture.md`
§8](docs/karunya-architecture.md#8-local-model-serving) for the cluster-scale target).

**GPU memory budget (single 32GB card, all three model services resident together):**

| Service | Footprint | Notes |
|---|---|---|
| vLLM (Qwen3-32B-AWQ) | ~18.0GB weights + ~4GB KV cache | `--gpu-memory-utilization 0.72`, `--max-model-len 15000` |
| TTS (VoxCPM2) | ~6.2GB | Always resident when the `media` profile is active |
| Image (SDXL) | Variable, kept low via `IMAGE_LOW_VRAM=1` | Sequential CPU offload — trades latency for footprint so it can coexist with the LLM instead of needing ~10GB fully resident |

`--gpu-memory-utilization` is a fraction of the GPU's *total* memory reserved for
vLLM's entire footprint (weights + KV cache), not a fraction of free memory — tune it
by watching vLLM's own boot-log line (`Available KV cache memory: ...`), not by
computing an estimate; there's consistently a small gap (torch.compile/CUDA-graph
capture overhead) between the two.

**Running the LLM alone (no image/TTS), or on a bigger GPU:** there's real headroom to
raise `--gpu-memory-utilization` and `--max-model-len` in the `vllm` service's
`command:` — the current values are deliberately conservative to leave room for
TTS+image on the same card. Redeploy (`docker compose ... up -d --force-recreate
vllm`) and read the new "Available KV cache memory" / "estimated maximum model length"
values vLLM reports at boot to find the real ceiling for your hardware.

**Pointing at a different/existing vLLM server instead** (e.g. one already running
elsewhere on your network, or a different model): unset `COMPOSE_PROFILES` in `.env`
(or override per-invocation: `COMPOSE_PROFILES= docker compose -f
docker-compose.remote.yml up -d --build`) so the containerized `vllm` service never
starts, and set:
```bash
MAIC_VLLM_MODEL=<bare-model-name-your-server-serves>
MAIC_VLLM_BASE_URL=http://<host>:<port>/v1
```
Any OpenAI-compatible server works — the app's provider layer (`lib/ai/`) doesn't
assume vLLM specifically.

**Swapping the containerized model for a different one:** update `MAIC_VLLM_MODEL` /
the `vllm` service's `--model`/`--served-model-name` in `docker-compose.remote.yml`,
and point the `vllm-prime` init container's `MODEL_TAG`/`MODEL_REPO` env vars at
wherever those weights are hosted (a GitHub Release in the same split-file layout, or
rework that service to pull from Hugging Face directly if your deploy host can reach
it — the current setup avoids that because the original network couldn't).

**TTS (VoxCPM2) and image generation (SDXL)** are profile-gated behind `media` (not
started by a plain `up`, since they share GPU headroom with the LLM — see the budget
table above) — bring them up explicitly:
```bash
docker compose -f docker-compose.remote.yml --profile media up -d image tts
```

## Default accounts

With `MAIC_SEED_DEV_USERS=true` (the default), two demo accounts are seeded on first
migration:

| Role | Email | Password |
|---|---|---|
| Teacher | `admin@karunya.edu` | `teacher123` |
| Student | `student1@karunya.edu` | `student123` |

These are intentionally weak, well-known credentials for a first smoke test — **not**
for production. Real authentication (Active Directory / LDAP) is designed
(`lib/auth/`, pluggable `AuthProvider`) but not yet wired to a real directory; see
[Going to production](#going-to-production).

## Going to production

Before this is reachable by real users:

1. **Replace every secret in `.env`** (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`,
   `SESSION_SECRET`) with your own random values.
2. **Wire up real authentication.** `AUTH_MODE=dev` (the current default) uses seeded
   local accounts. Set `MAIC_SEED_DEV_USERS=false` and implement/enable `AUTH_MODE=ldap`
   against your Active Directory once its host/baseDN/bind credentials/group DNs are
   available (`lib/auth/` is already structured for this — see
   [`docs/karunya-architecture.md` §5](docs/karunya-architecture.md#5-authentication--authorization-adldap)).
3. **Put TLS in front of it** — the app itself serves plain HTTP on `MAIC_APP_PORT`;
   terminate TLS at a reverse proxy/ingress in front.
4. **Scaling beyond one box:** the app tier is already stateless (sessions in Redis,
   media in MinIO, course content in Postgres) and safe to run with multiple replicas.
   `deploy/k8s/` has parameterized Kubernetes manifests for a real cluster deployment —
   see [`deploy/k8s/README.md`](deploy/k8s/README.md) for what needs filling in
   (storage class, GPU node labels, ingress, AD details).

## Repository layout

- **`OpenMAIC/`** — the application. See [`OpenMAIC/README.md`](OpenMAIC/README.md)
  for architecture, local dev commands, and app-level configuration.
- **`deploy/`** — everything needed to run the stack outside a laptop:
  - `deploy/tts-voxcpm/`, `deploy/image-sdxl/` — the TTS/image model servers
    (`Dockerfile` for the containerized path used by `docker-compose.remote.yml`;
    `start.sh`/`stop.sh` for standalone iteration outside Docker).
  - `deploy/k8s/` — parameterized Kubernetes manifests for a production cluster
    deployment.
  - `deploy/loadtest.mjs`, `deploy/migrate-media-to-minio.mjs` — one-off ops scripts.
- **`docs/`** — [`karunya-architecture.md`](docs/karunya-architecture.md) is the full
  design doc; `docs/papers/` holds the research papers OpenMAIC's approach is built on.
- **`docker-compose.remote.yml`** — the deploy path described above.

## License

AGPL-3.0, inherited from upstream OpenMAIC — see [`OpenMAIC/LICENSE`](OpenMAIC/LICENSE).
