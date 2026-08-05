# karunya-openmaic

A multi-user LMS for Karunya University, built by layering a multi-tenant platform
(auth/RBAC, courses, cohorts, progress tracking, teacher dashboard) on top of
[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) — an open-source, multi-agent AI
classroom generator. Upstream OpenMAIC is single-user and browser-local; this fork
adds real server-side identity, persistence, and a teacher-facing publish/assign
workflow, while keeping the platform additions in new, separate modules so upstream
merges stay clean.

## Layout

- **`OpenMAIC/`** — the app itself (Next.js, upstream-derived). See
  [`OpenMAIC/README.md`](OpenMAIC/README.md) for the app's own architecture, commands,
  and configuration, and [`CLAUDE.md`](CLAUDE.md) for the Karunya-specific platform
  layer (auth, courses, teacher dashboard, deploy) added on top.
- **`deploy/`** — everything needed to run the stack outside a laptop: local model
  servers for TTS (`deploy/tts-voxcpm/`) and image generation (`deploy/image-sdxl/`),
  parameterized Kubernetes manifests (`deploy/k8s/`), and one-off ops scripts
  (load test, media→MinIO migration).
- **`docs/`** — [`karunya-architecture.md`](docs/karunya-architecture.md) is the full
  design doc; `docs/papers/` holds the research papers OpenMAIC's approach is built on.
- **`docker-compose.remote.yml`** + **`bootstrap-remote.sh`** — the actual deploy path:
  a fully containerized stack (app, Postgres, Redis, MinIO, and optionally a
  containerized vLLM + TTS/image servers) for a machine you don't control beyond
  Docker itself. This is what currently runs the platform.

## Deploying

```bash
./bootstrap-remote.sh
```

Clones/updates the repo, generates a real `.env`, builds images, primes model caches
from pre-packaged GitHub Releases, and brings the stack up. See `CLAUDE.md`'s
"Karunya customization" section for the full bring-up flow, including the on-demand
`media` Compose profile that trades GPU headroom between a large resident LLM and the
image/TTS services.

## Continuity docs (for agent-assisted sessions)

`feature_list.json` (scope/state, source of truth), `progress.md` (dated session log),
`session-handoff.md` (larger multi-session handoffs) — see `CLAUDE.md`'s "Harness &
Session Workflow" section for how these are meant to be used.

## License

AGPL-3.0, inherited from upstream OpenMAIC — see [`OpenMAIC/LICENSE`](OpenMAIC/LICENSE).
