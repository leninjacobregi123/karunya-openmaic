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
- `ACCESS_CODE` gates the whole site (UI prompt + all API routes) when set; auth is wired in `middleware.ts`.
- `NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true` is a build-time flag that turns on the MAIC Editor (Pro mode).

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
