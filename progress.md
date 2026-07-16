# Session Progress Log

## Current State

**Last Updated:** 2026-06-16
**Active Feature:** feat-060 — Phase 5 scale-hardening: load test + K8s manifests + MULTI-REPLICA CODE HARDENING DONE (playback stateless: content from Postgres, media from MinIO, job state in Redis). REMAINING = ops only (build/push prod image + cluster deploy, gated on feat-005). Phases 0-4 complete in dev.
**Project:** Customize OpenMAIC into a multi-user LMS for Karunya University — see `docs/karunya-architecture.md`.
**Stack decisions:** custom sessions (pluggable AuthProvider: dev now, LDAP/AD later) + Drizzle ORM + Postgres/Redis/MinIO. Not Auth.js/Prisma.

## Status

### What's Done

- [x] Harness scaffolded at workspace root (CLAUDE.md, init.sh, feature_list.json, progress.md, session-handoff.md)
- [x] feat-000 — Baseline green: `./init.sh` passed clean
- [x] Read both research papers (papers/) → memory `maic-research-foundation`
- [x] Full codebase read across 6 dimensions (auth, persistence, course lifecycle, LLM providers, features, deployment)
- [x] feat-001 — Architecture design doc `docs/karunya-architecture.md` v1
- [x] Project decisions captured → memory `karunya-deployment-project`; phased plan loaded into feature_list.json (feat-010..060)
- [x] feat-002 — Local dev in Docker running: `docker-compose.dev.yml` + `Dockerfile.dev`; app on :3000, host Ollama, LLM smoke test OK
- [x] Full generation pipeline VALIDATED on `ollama:qwen3.6:35b`: generated classroom `PXi2Drcmil` ("What is the Water Cycle?") — 2 slides (real canvas elements + spotlight/speech teaching actions) + 3-question quiz + 6 agents + narration. Persisted to /app/data/classrooms; page loads 200. ~7 min for 3 scenes (sequential scene gen on 35B — optimize later via parallelSceneConcurrency + vLLM batching).
- [x] feat-003 — Local TTS (VoxCPM2) wired + validated: host server `deploy/tts-voxcpm` (./start.sh, :8000, 48kHz, torch2.11+cu128, PYTORCH_JIT=0 for GB10 sm_121); OpenMAIC `/api/generate/tts` returns WAV; server-managed provider.

- [x] feat-004 — Local image gen (SDXL) wired + validated: host server `deploy/image-sdxl` (./start.sh, :8001); OpenMAIC `lemonade` provider; regenerated course `dpd_r20zDT` with 3 SDXL slide images served via /api/classroom-media. Beta CONTENT features (slides+images+quiz) now generate locally; narration TTS works on-demand.

- [x] Teacher-chat (live AI teacher) VALIDATED: POST /api/chat, single agent default-1, SSE streamed correct answer on ollama:qwen3.6:35b (thinking/agent_start/44×text_delta/agent_end/done).
- [x] Parallel scene gen enabled: PARALLEL_SCENE_CONCURRENCY=4 (interactive flow only; async /api/generate-classroom is serial regardless; real speedup also needs host OLLAMA_NUM_PARALLEL / prod vLLM batching).

## Beta feature status (dev, local models)
All chosen beta features now work locally: slides + SDXL images + quiz (generation), AI-teacher TTS narration (on-demand), and live teacher chat. Remaining content-side follow-ups: server-side TTS pre-gen at publish; generation speed at scale (vLLM).

- [x] feat-007 — Data infra up in dev (Postgres/Redis/MinIO), reachable from app container; bucket maic-media created.

## Dev connection details (for Phase 1+ app code)
- Postgres: `postgresql://maic:maic_dev_pw@localhost:5433/maic`
- Redis: `redis://localhost:6379`
- MinIO (S3): endpoint `http://localhost:9000`, key `maic`, secret `maic_dev_pw`, bucket `maic-media`, console `http://localhost:9001`
- (Dev-only creds in docker-compose.dev.yml. App uses host networking → localhost. Postgres on 5433 because host already runs a pg on 5432.)

## Local model servers (dev, on GB10 host)
- LLM: host Ollama :11434 (qwen3.6:35b default).
- TTS: `deploy/tts-voxcpm/start.sh` :8000 (VoxCPM2).
- Image: `deploy/image-sdxl/start.sh` :8001 (SDXL).
- Both Python servers: torch 2.11+cu128, PYTORCH_JIT=0 (GB10 sm_121 nvrtc caveat), reached from dev container via host networking.

## VoxCPM TTS dev notes
- Start/stop: `deploy/tts-voxcpm/start.sh` / `stop.sh` (NEVER `pkill -f server.py` — matches your own shell and suicides; use fuser -k 8000/tcp).
- GB10/Blackwell sm_121 quirk: must run with `PYTORCH_JIT=0` (cu128 nvrtc rejects sm_121 for JIT-fused kernels).
- Open follow-up: server-side TTS pre-generation at publish time — OpenMAIC skips server-side TTS for `voxcpm:auto` voice (needs agent voiceDesign); playback currently synthesizes narration client-side on demand.

## Dev environment notes (this GB10 box)

- Run dev: `docker compose -f docker-compose.dev.yml up -d` (workspace root); logs `... logs -f`; stop `... down`.
- Arch: arm64 (NVIDIA GB10). Dev container reuses HOST node_modules (host Node 22.22.1 == container Node 22). If deps change, re-run `./init.sh` on host before restarting.
- Uses `network_mode: host` (fixes container DNS on this box + reaches host Ollama at localhost:11434).
- Host Ollama has many models (qwen3.6:35b, gpt-oss:120b, gemma4:31b, devstral-2:123b, ...). Dev default = `ollama:qwen3.6:35b`.
- The user's previous PROD container (`openmaic-openmaic-1`, upstream OpenMAIC/docker-compose.yml, pointing at `ayin:4000` gateway / model `ayin-main`) was stopped by the user to free :3000. To use that gateway in dev instead of Ollama: set DEFAULT_MODEL=openai:ayin-main + OPENAI_BASE_URL + OPENAI_API_KEY.

### What's Done (recent)

- [x] feat-020 — Phase 1 Identity & RBAC COMPLETE: auth (login/logout/session, edge-safe HMAC tokens, pluggable AuthProvider), middleware session+RBAC, student UI lockdown (StudentHome early-return) + UserMenu logout. Validated via API + Playwright screenshots.

- [x] feat-030 — Phase 2 (backend + student side): publish-immutable courses, cohorts/roster/assign APIs, enrollment-gated playback, student "My Courses". Validated end-to-end + Playwright.
- [x] feat-040 — Phase 3: progress + quiz + chat-transcript persistence + teacher report/transcript APIs; client telemetry wired (progress page, quiz grade flow, chat in /api/chat). Validated end-to-end (curl + real browser playback + real chat).
- [x] feat-050 — Phase 4: teacher dashboard (/teacher publish/cohort/roster/assign + /teacher/courses/[id] progress & transcripts); GET /api/classrooms + /api/cohorts; /teacher gated. Validated curl + Playwright. init.sh green.
- [~] feat-060 — Phase 5: load test (deploy/loadtest.mjs: 0 errors @500 concurrent, ~130 req/s single dev replica) + K8s manifests (deploy/k8s/) + README/runbook DONE. Code-hardening (MinIO media, Redis job queue, prod image, cluster deploy) REMAIN.

- [x] feat-060 multi-replica hardening (2026-06-21): playback content from Postgres manifest (A), media→MinIO upload+serve (B, validated via disk-absent probe), generation job store→Redis (C). Deps: ioredis, minio. Playback path now fully stateless → web.replicas>1 safe with shared PG/Redis/MinIO. init.sh green (815 tests).

### Phase 5 scaling notes
- Playback = static serve + enrollment check (no LLM) → scales horizontally; bottleneck is per-process, fixed by prod build + replicas.
- Multi-replica BLOCKERS (must fix before web.replicas>1): media on pod-local disk → MinIO (or serve playback from course_versions.manifest in PG); in-memory generation job Map (lib/server/classroom-job-runner.ts) → Redis queue + worker.
- K8s manifests: deploy/k8s/*.yaml (REPLACE_ME = feat-005 cluster values). Load test: `node deploy/loadtest.mjs`.

### Note: vitest under load
- Full vitest can show 1 flaky TIMEOUT (e.g. tests/edit/round-trip/insert.test.ts, 5s) when the GB10 is busy (dev app + Ollama + VoxCPM + SDXL). Passes in isolation (`pnpm vitest run <file>`). Not a regression.

### What's In Progress

- [ ] feat-005 — Cluster prerequisites: blocked pending info from user (see Blockers)
- [ ] Next: feat-040 (Phase 3 progress/grading/transcripts) and/or feat-050 teacher dashboard UI (publish/cohort/roster/assign are API-only today).

### Phase 2 dev notes
- Publish: POST /api/courses/publish {classroomId}. List: GET /api/courses (role-aware). Cohort: POST /api/cohorts. Roster: POST /api/cohorts/{id}/roster (JSON {emails:[]} or CSV; provisions missing students with ROSTER_DEFAULT_PASSWORD=student123). Assign: POST /api/courses/assign {courseId,courseVersionId,cohortId}.
- Playback access: /api/classroom GET is enrollment-gated for students (canAccessClassroom); teachers/admins unrestricted.
- Media still served from disk (/api/classroom-media); course_versions.manifest holds an immutable snapshot but playback currently reads disk. MinIO migration + manifest-based playback = hardening follow-ups.

### Auth (Phase 1) dev notes
- Login at /login. Dev accounts: admin@karunya.edu / teacher123 (teacher); student1@karunya.edu / student123 (student); student2 likewise.
- Session = signed HMAC cookie `maic_session` (8h), verified in middleware (edge) and getCurrentUser (node). NO Redis in middleware (edge can't reach it); Redis reserved for job queue / future revocation denylist.
- ACCESS_CODE flow is superseded by session auth (ACCESS_CODE unset in dev compose).
- To add real AD later: implement LdapProvider, set AUTH_MODE=ldap (provider factory already switches on it).
- Teacher-only API surface enforced in middleware: /api/generate-classroom, /api/generate/scene*, /api/generate/image|video, POST /api/classroom, /generation-preview. Students keep chat/tts/quiz-grade/classroom GET/media.

### What's Next

1. Collect cluster specifics (feat-005) → then start Phase 0 (feat-010)
2. Phase 0: stand up local model serving + Postgres/Redis/MinIO + containerize for K8s; validate end-to-end generation on local LLMs

## Blockers / Risks

- [ ] **feat-005 blocker — cluster specifics needed before Phase 0 build:** storage class (RWO/RWX), ingress controller + TLS, GPU node labels/taints, container registry, AD server host/baseDN/bind account + exact faculty group DN.
- [ ] Local-LLM generation quality must be validated as the Phase 0 exit criterion before building the platform on top.
- [ ] Playback source-of-truth shift (IndexedDB → server) is the riskiest code change; isolate behind a storage interface.
- [ ] `pnpm install` postinstall (workspace build + maic-importer vendor sync) is slow on first run; failure blocks everything downstream.

## Decisions Made

- **Harness lives at workspace root, code stays in `OpenMAIC/`**: `init.sh` cd's into `OpenMAIC/` for all gates. Chosen because CLAUDE.md was already placed at the workspace root.

## Files Modified This Session

- `CLAUDE.md` — added Harness & Session Workflow section
- `init.sh`, `feature_list.json`, `progress.md`, `session-handoff.md` — created

## Evidence of Completion

- [x] `./init.sh` passes (2026-06-18, after Phase 1-3): prettier OK; eslint 0 errors (19 pre-existing warnings); tsc clean; i18n parity OK (8 locales); vitest 815 passed / 109 files. (Added `lib/db/migrations/` to .prettierignore — drizzle-generated.)
- [x] `./init.sh` passed (2026-06-16): baseline green.

## Notes for Next Session

Verification gates and architecture map live in `CLAUDE.md`. Heavy gates (`pnpm build`, `pnpm test:e2e`) are intentionally out of the fast `./init.sh` loop — run them only when your change touches the build or e2e flows.
