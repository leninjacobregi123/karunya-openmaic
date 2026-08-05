# Session Handoff

## Current Objective

- Goal: Get feat-010 (Phase 0 — Infra & local models) to its exit criterion — a teacher can generate a slides+TTS course end-to-end on local LLMs with acceptable quality — on shannon, then leave the repo in a professionally organized state.
- Current status: LLM (Qwen3-32B-AWQ, containerized vLLM) + TTS (VoxCPM2) confirmed working together end-to-end via a real user course generation. Image generation (SDXL) still needs validation resident alongside vllm+tts under real load — `vllm`'s `gpu-memory-utilization`/`max-model-len` (currently 0.72/15000 in `docker-compose.remote.yml`) was set from a prediction, not yet confirmed against vLLM's own reported KV-cache numbers at this exact tuning.
- Branch / commit: `feat/portable-dev-startup` @ `6348fb6` (PRs up through #40 merged to `main`), plus this session's uncommitted repo-cleanup pass (see Files Changed below).

## Completed This Session

- [x] Swapped shannon's vLLM model `openai/gpt-oss-20b` → `Qwen/Qwen3-14B-AWQ` → `Qwen/Qwen3-32B-AWQ` (packaged as GitHub Release `qwen3-32b-awq-model`, old releases deleted)
- [x] Fixed VoxCPM TTS voice-registration 404 (PR #33 — `/v1/audio/voices` was never implemented)
- [x] Fixed image-generation prompt ambiguity causing zero images across real course generations (PR #34)
- [x] Built, then abandoned, an on-demand `media` Compose profile (PRs #35-#36) after discovering the real course-generation flow interleaves LLM and media/TTS calls — no clean phase boundary exists to toggle on
- [x] Retuned for all three services (vllm+tts+image) resident together: `IMAGE_LOW_VRAM=1` forces SDXL's existing sequential-CPU-offload path (PR #39); `vllm` utilization/max-model-len lowered to fit (PR #40)
- [x] Fixed two real infra bugs found along the way: no retry/resume in `prime-model-cache.sh` downloads (PR #37), `bootstrap-remote.sh` nested-checkout bug causing a Postgres password mismatch (PR #38)
- [x] Recovered a shannon disk-space crisis (`/home` at 100%) via `docker builder prune -af` (385.8GB reclaimable freed) — flagged but did NOT touch the unrelated `malayalam-llm` image (151GB) or `Ammini` project dir (134GB) also on that disk
- [x] Repo cleanup: removed obsolete non-Docker local dev-stack path (`start.sh`, `docker-compose.dev.yml`, `Dockerfile.dev`), dead/corrupt scratch files, moved `papers/` → `docs/papers/`, added root `README.md`, updated `CLAUDE.md`'s dev-stack section and both `deploy/*/README.md`s to match the actual current flow

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Baseline | `./init.sh` | PASS | 815/815 tests, 0 eslint errors (19 pre-existing warnings), i18n parity OK, tsc clean — run 2026-08-05 after the cleanup pass |
| Build (if touched) | `cd OpenMAIC && pnpm build` | not run | No `OpenMAIC/` internals touched this session |
| E2E (if touched) | `cd OpenMAIC && pnpm test:e2e` | not run | Same as above; app itself only ever runs on shannon, not locally |
| Real LLM+TTS course generation | manual, on shannon via UI | PASS | User-confirmed: vllm+tts resident together produced a full, correct course |
| Real image-gen under load | manual, on shannon via UI | not yet run | Pending — see Next Session Startup |

## Files Changed

- `docker-compose.remote.yml`, `prime-model-cache.sh`, `bootstrap-remote.sh`, `deploy/image-sdxl/server.py` — model swap, retry/resume fix, nested-checkout fix, `IMAGE_LOW_VRAM` (all committed, PRs #31-#40 merged to `main`)
- `OpenMAIC/lib/prompts/templates/requirements-to-outlines/system.md` — image-generation prompt fix (committed, PR #34)
- `deploy/tts-voxcpm/server.py`, `deploy/tts-voxcpm/Dockerfile` — voice-registration fix (committed, PR #33)
- Uncommitted (this cleanup pass): deleted `start.sh`, `docker-compose.dev.yml`, `Dockerfile.dev`, `check-image-pull.sh`, `voxcpm2.tar.gz`; moved `papers/` → `docs/papers/`; added root `README.md`; edited `CLAUDE.md`, `deploy/tts-voxcpm/README.md`, `deploy/image-sdxl/README.md`, both `deploy/*/start.sh`, `progress.md`, `feature_list.json`, this file

## Decisions Made

- Chose Qwen3-32B-AWQ over staying on 14B despite it not fitting alongside always-resident image+tts — user explicitly traded a smaller/always-concurrent model for a bigger/more-capable one, accepting the retuning work that followed.
- Abandoned the on-demand media-profile toggle once real usage showed LLM and media calls are interleaved, not phased — retuned for concurrent residency instead of trying to force a phase boundary into the app.
- Repo cleanup scoped to workspace root + `deploy/` only; `OpenMAIC/`'s internal layout (`app/`, `components/`, `lib/ai`, etc.) deliberately left untouched to preserve clean upstream merges (explicit user decision).
- Removed the local non-Docker dev-stack path entirely rather than keeping it as an alternate onboarding path (explicit user decision) — it now contradicts the shannon-only rule.

## Blockers / Risks

- [ ] image's real VRAM footprint under *active* SDXL generation (not just idle-but-warm) hasn't been measured — the 0.72/15000 vllm tuning could still be wrong under real load; same empirical retune loop as every step before it if so.
- [ ] `docs/karunya-architecture.md` still says "LLM = host Ollama (not vLLM yet)" — stale, out of this session's scope to fix, but worth a future pass.
- [ ] Shannon disk: `malayalam-llm` Docker image (151GB) and `Ammini` project dir (134GB) are unrelated to this repo but consuming most of `/home` — user said "later" on deciding whether to clean these up.
- [ ] This cleanup pass is uncommitted — confirm the diff with the user before commit/push/PR (per the approved plan, not auto-committed).

## Next Session Startup

1. Read `CLAUDE.md` (Harness & Session Workflow section).
2. Read `feature_list.json` and `progress.md` (see the 2026-08-05 dated entry for full context).
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- On shannon: bring up vllm+tts+image together, trigger a real image generation, watch `nvidia-smi` for peak usage during the active SDXL call, and retune `gpu-memory-utilization`/`max-model-len` from vLLM's own reported numbers if the current 0.72/15000 doesn't hold. Once confirmed, feat-010's exit criterion is fully met.
- Separately: get the user's decision on committing this repo-cleanup pass, and on whether to clean up the unrelated `malayalam-llm`/`Ammini` disk usage on shannon.
