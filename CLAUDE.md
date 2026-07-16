# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout note

The actual project lives in the `OpenMAIC/` subdirectory of the workspace (it holds `.git`, `package.json`, etc.). Run all commands below from inside `OpenMAIC/`.

## Harness & Session Workflow

This workspace root carries a lightweight agent harness. Use it every session.

**Startup (before writing code):**

1. `pwd` to confirm you're at the workspace root.
2. Read this file, then `feature_list.json` and `progress.md`.
3. Run `./init.sh` — it `cd`s into `OpenMAIC/` and runs the full fast verification loop (install, prettier check, eslint, `tsc --noEmit`, i18n key parity, vitest). If baseline is red, fix that before adding scope.
4. `cd OpenMAIC && git log --oneline -5` for recent context.

**Working rules:**

- One feature at a time — pick a single entry from `feature_list.json` whose `dependencies` are all `done` and set its `status` to `in-progress`.
- Stay in scope: don't touch files unrelated to the active feature (CONTRIBUTING requires one concern per PR).
- Don't claim done without running verification.

**Definition of done** (all must hold):

- Target behavior implemented.
- `./init.sh` passes (plus `pnpm build` / `pnpm test:e2e` if the change touches build or e2e flows).
- Evidence (command + result) recorded in the feature's `evidence` field and/or `progress.md`.
- Repo is restartable: next session can run `./init.sh` immediately.

**End of session:** update `progress.md` and `feature_list.json`; for larger multi-session work also fill in `session-handoff.md`; commit once state is safe (Conventional Commits, link an issue).

Harness files: `init.sh` (verification), `feature_list.json` (scope/state, source of truth), `progress.md` (continuity log), `session-handoff.md` (larger handoffs).

## Commands

Package manager is **pnpm** (>= 10, see `packageManager` pin); Node >= 20.9.0.

```bash
pnpm install          # also runs postinstall: builds workspace packages + syncs maic-importer vendor bundle
pnpm dev              # Next.js dev server on :3000
pnpm build            # asserts vendored maic-importer is present, then next build
pnpm start            # production server

pnpm lint             # eslint (use `pnpm lint --fix` to autofix)
pnpm format           # prettier --write
pnpm check            # prettier --check (CI format gate)
npx tsc --noEmit      # type check (part of the PR checklist)
pnpm check:i18n-keys  # verify locale key parity across lib/i18n/locales/

pnpm test             # vitest run — unit tests in tests/**/*.test.ts
pnpm test:e2e         # playwright (e2e/tests/, dev server on :3002)
pnpm test:e2e:ui      # playwright UI mode
```

Run a single unit test: `pnpm vitest run tests/path/to/file.test.ts` (or `pnpm vitest -t "name"`).

Evals are a **separate** vitest config (`vitest.eval.config.ts`, files `tests/**/*.eval.test.ts`) and standalone runners: `pnpm eval:whiteboard`, `pnpm eval:outline-language`, `pnpm eval:orchestration[:answering|:answer-content]`.

## Configuration

- Copy `.env.example` → `.env.local`. At least one LLM provider key is required.
- Models are referenced everywhere as **`provider:model`** strings (e.g. `google:gemini-3-flash-preview`, `anthropic:claude-opus-4-8`). `DEFAULT_MODEL` sets the server-side default.
- Providers can be configured by env keys *or* a `server-providers.yml` file. The provider abstraction lives in `lib/ai/` (`providers.ts`, `llm.ts` is the single entry for all LLM calls via `callLLM`/`streamLLM`; thinking/reasoning config in `thinking-config.ts`).
- `ACCESS_CODE` is upstream's single shared-password gate. **In this fork it is superseded** by real session auth (see Karunya customization); leave it unset.
- `NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true` is a build-time flag that turns on the MAIC Editor (Pro mode).

## Karunya customization (this fork)

This repo is being customized into a **multi-user LMS for Karunya University** (full design: `docs/karunya-architecture.md`). Upstream OpenMAIC is single-user/browser-local; we layered a multi-tenant platform on top. **Status: Phases 0–5 implemented & validated in dev** on a single GB10 box; only real-cluster deploy + AD/LDAP wiring remain. The platform additions live in new modules so upstream merges stay clean.

### Run the full dev stack (this GB10 box)

```bash
# 1. local model servers on the host GPU
deploy/tts-voxcpm/start.sh        # VoxCPM2 TTS    :8000
deploy/image-sdxl/start.sh        # SDXL images    :8001
#    LLM = host Ollama :11434 (models incl qwen3.6:35b); see deploy/*/README.md
# 2. app + Postgres/Redis/MinIO (from workspace root)
docker compose -f docker-compose.dev.yml up -d     # app on http://localhost:3000
```

- Dev container uses **host networking** and **reuses host `node_modules`** — if deps change, run `./init.sh` then `docker compose -f docker-compose.dev.yml restart openmaic-dev`.
- DB: `cd OpenMAIC && DATABASE_URL=postgresql://maic:maic_dev_pw@localhost:5433/maic pnpm exec drizzle-kit migrate`; seed dev users: `pnpm tsx lib/db/seed.ts`.
- Dev logins: `admin@karunya.edu / teacher123` (teacher), `student1@karunya.edu / student123` (student).
- GB10 (Blackwell sm_121) quirk: the model servers run with `PYTORCH_JIT=0` (cu128 nvrtc rejects sm_121 for JIT-fused kernels) — see `deploy/*/README.md`.

### Platform layer (added on top of upstream)

- **DB (Drizzle/Postgres)** — `lib/db/`: users/roles, courses, `course_versions` (immutable manifests), cohorts, enrollments, progress, quiz_results, chat_messages.
- **Auth & RBAC** — `lib/auth/`: edge-safe HMAC session tokens, pluggable `AuthProvider` (`DevAccountsProvider` now → `LdapProvider` via `AUTH_MODE=ldap`); `app/api/auth/*`, `app/login/`. `middleware.ts` enforces session + **teacher-only RBAC** + injects identity headers.
- **Courses / enrollment** — `lib/courses/service.ts` + `app/api/courses/*`, `app/api/cohorts/*`: publish-immutable, cohorts, CSV roster, assign. Student "My Courses" = `components/student-home.tsx`; `/api/classroom` GET is enrollment-gated and serves published content from the Postgres manifest.
- **Progress / analytics** — `lib/courses/progress-service.ts` + `/api/progress`, `/api/quiz-result`, `/api/chat-log`, teacher `/api/courses/[id]/progress|transcript`; client telemetry `lib/courses/telemetry.ts` (wired into the playback page, quiz grade flow, and `/api/chat`).
- **Teacher dashboard** — `app/teacher/` (publish, cohort/roster, assign, per-student progress + transcripts).
- **Stateless-scaling infra** — `lib/server/redis.ts` (job store is Redis-backed), `lib/server/s3.ts` (media uploaded to MinIO on generation, served MinIO-first). These make the web tier safe for `web.replicas > 1`.

### New env (set by `docker-compose.dev.yml`)

`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `AUTH_MODE` (`dev`|`ldap`), `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`, `PARALLEL_SCENE_CONCURRENCY`, and local-model endpoints `DEFAULT_MODEL`/`OLLAMA_BASE_URL`, `TTS_VOXCPM_BASE_URL`, `IMAGE_LEMONADE_BASE_URL`.

### Deploy artifacts (`deploy/`, at workspace root — kept out of `OpenMAIC/`)

- `deploy/tts-voxcpm/`, `deploy/image-sdxl/` — local model servers (`start.sh`/`stop.sh`/README).
- `deploy/k8s/` — parameterized production manifests + runbook (`REPLACE_ME` = cluster specifics, i.e. `feat-005`).
- `deploy/loadtest.mjs` — playback load test; `deploy/migrate-media-to-minio.mjs` — one-off media → MinIO migration.

### Remaining (gated on external inputs)

Real AD/LDAP `LdapProvider` (needs AD host/baseDN/bind/group DN); cluster deployment (fill `deploy/k8s` `REPLACE_ME`); i18n the new English UI strings (student landing, login, dashboard).

## Architecture

OpenMAIC turns a topic/document into an interactive multi-agent classroom. Two big phases: **generate** a lesson, then **play it back** with live agent orchestration. Both are driven by LLMs and rendered on a canvas-based slide stage.

### Generation pipeline (`lib/generation/`)

Two stages: **outline → scenes**. `outline-generator.ts` produces a structured outline; `scene-generator.ts` / `scene-builder.ts` expand each outline item into a `Scene` (slide / quiz / interactive / PBL). `generation-pipeline.ts` + `pipeline-runner.ts` orchestrate the run; `action-parser.ts` parses streamed model output into actions; `json-repair.ts` + `interactive-post-processor.ts` clean LLM output. Server entry points are under `app/api/generate/` (scene generation) and `app/api/generate-classroom/` (async job submit + poll).

### Multi-agent orchestration (`lib/orchestration/`)

A **LangGraph** `StateGraph` (`director-graph.ts`): `START → director → (agent_generate | END)`. Each request runs at most one director→agent cycle; the client serializes requests to drive a discussion (the topology is the turn bound, no maxTurns). Director uses pure code logic for a single agent and an LLM decision for multiple agents. Streams `StatelessEvent` chunks over SSE via LangGraph's custom stream writer. `ai-sdk-adapter.ts` bridges the Vercel AI SDK to LangGraph; agents come from `registry/`; prompts from `director-prompt.ts` / `prompt-builder.ts`; turn/whiteboard ledger types in `types.ts`. Served by `app/api/chat/`.

### Playback engine (`lib/playback/engine.ts`)

A state machine: `idle → playing ⇄ paused`, and `playing → live` (discussion) ⇄ `paused`. Consumes `Scene.actions[]` **directly** (no compile step) and executes them through the **Action Engine** (`lib/action/engine.ts`), which runs ~28 action types: speech (TTS), whiteboard draw/text/shape/chart/latex/table/code, spotlight, laser, navigation, discussion triggers, etc. `derived-state.ts` computes view state.

### Stage API facade (`lib/api/stage-api*.ts`)

`createStageAPI(stageStore)` is the high-level, idempotent toolkit agents/code use to mutate course content — split into sub-APIs: `scene`, `element`, `canvas`, `navigation`, `whiteboard`, `mode`. Returns explicit `APIResult` success/failure. This is the seam between AI actions and the canvas/store.

### State (`lib/store/`, Zustand)

Stores for `canvas`, `stage`, `settings`, `media-generation`, `user-profile`, whiteboard history, iframe pools, etc. Client-side persistence uses Dexie/IndexedDB (`lib/storage/`).

### `@maic` SDK packages (`packages/@maic/`)

A small dependency-acyclic SDK family — keep the arrows clean:

- **`@maic/dsl`** — *pure spec*, zero runtime deps. The canonical slide/lesson object model (`Slide`, `PPTElement`, `Stage`, generic `Scene<TAction, TContent>`, type guards, DSL version/migrations). Everything depends on this; it depends on nothing. App-specific `Action`/widget/PBL types stay app-side and plug into `Scene<...>` via generics.
- **`@maic/renderer`** → depends on `@maic/dsl`. Renders the slide DSL (ships fonts).
- **`@maic/importer`** → depends on `@maic/dsl`. Imports external decks (e.g. PPTX/PDF) into DSL `Slide` objects.

Other workspace packages: `packages/pptxgenjs` (customized PPTX export) and `packages/mathml2omml` (MathML → Office Math). `packages/docs` is excluded from the workspace (own lockfile/build).

#### maic-importer vendor sync (important build mechanism)

The importer bundle uses dynamic `require()` (from pdfjs-dist) that **Turbopack refuses to bundle**. So `scripts/sync-maic-importer.mjs` copies `packages/@maic/importer/dist/` → `public/vendor/maic-importer/`, and the app loads it at runtime via a **URL-based dynamic import** (types still come from the workspace package). `postinstall` builds the packages and runs the sync; `pnpm build` runs `scripts/assert-vendor-maic-importer.mjs` to fail fast if the vendor bundle is missing. If importer changes don't show up, re-run `pnpm sync:maic-importer` (after rebuilding the package).

### App routes (`app/`)

Next.js **App Router**. `app/page.tsx` is the generation input; `app/classroom/[id]/` is playback. `app/api/` has ~18 route handlers (generate, generate-classroom, chat, pbl, quiz-grade, parse-pdf, web-search, transcription, verify-*, server-providers, access-code, health, …).

## Conventions

- **All user-facing strings must be internationalized** — never hardcode UI text. Locales live in `lib/i18n/locales/` (zh-CN, zh-TW, en-US, ja-JP, ru-RU, ar-SA, pt-BR); run `pnpm check:i18n-keys` after touching them.
- Path alias `@/` → repo root (configured in `tsconfig.json` and both vitest configs).
- Logging goes through `createLogger(name)` from `lib/logger.ts`, not raw `console`.
- Conventional Commits (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`ci`/`perf`/`style`), branches `feat/` `fix/` `docs/`. Every PR links an issue (`Closes #123`). Refactor-only PRs are not accepted unless a maintainer requests them.
- License is **AGPL-3.0**.
