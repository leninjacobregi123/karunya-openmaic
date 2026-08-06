# OpenMAIC for Karunya University — Architecture & Design

**Status:** v3 (as-deployed) · **Updated:** 2026-08-06 · **Owner:** admin@karunya.edu

This document specifies how we turn upstream **OpenMAIC** (a single-user, browser-local classroom tool) into a **multi-user learning platform** for Karunya University, with local LLMs.

**Current reality vs. original target:** the design below (§1, §4, §8, §10) was originally
scoped for an on-prem Kubernetes cluster with multiple 40–80GB datacenter GPUs. What's
actually built and running today is a single-GPU Docker Compose deployment (see the root
[`README.md`](../README.md) for the exact command and configuration) — everything in the
app/platform layer (auth, courses, persistence, teacher dashboard) is unchanged from that
target, but model serving is scaled down to fit one consumer GPU. The Kubernetes manifests
in `deploy/k8s/` implement the original cluster target and are ready to use once real
cluster infrastructure (see §13) is available; they are not what's currently deployed.

---

## 0. Implementation status (as-built)

Phases 0–5 are **implemented and validated in dev**, currently running as a single-box
Docker Compose deployment (`docker-compose.remote.yml` at the repo root) with fully
containerized local models. Real-cluster deployment and the production AD/LDAP binding
remain (both gated on external inputs — cluster specifics + AD details, see §13).

| Phase | Status | Notes / deviations from the original plan |
|---|---|---|
| 0 Infra & local models | ✅ deployed | LLM = containerized **vLLM** serving `Qwen/Qwen3-32B-AWQ` (int4 AWQ, ~18GB weights) on a single 32GB GPU — see the root `README.md`'s "Local LLM Configuration" section for the full setup and tuning. TTS = **VoxCPM2**, images = **SDXL** (low-VRAM sequential-offload mode to coexist with the LLM on one card). All three run as Docker Compose services alongside Postgres/Redis/MinIO. |
| 1 Identity & RBAC | ✅ | **Custom HMAC session tokens** (edge-safe) + pluggable `AuthProvider`, not Auth.js. `DevAccountsProvider` live; `LdapProvider` pending AD details. |
| 2 Persistence & publish | ✅ | Drizzle/Postgres source of truth; publish-immutable; cohorts/roster/assign; student "My Courses". |
| 3 Progress / grading / transcripts | ✅ | Server persistence + teacher reports; client telemetry wired (progress, quiz, chat). |
| 4 Teacher dashboard | ✅ | `/teacher` publish/cohort/roster/assign + `/teacher/courses/[id]` analytics & transcripts. |
| 5 Scale hardening | ✅ code | Web tier made stateless (playback content from PG manifest, media on MinIO, job store on Redis); load test + K8s manifests done. Cluster deploy = ops. |

**Key as-built deviations to know:**

- **Auth:** custom sessions + Drizzle (chosen over Auth.js + Prisma) — see §5.
- **Media:** generation writes to disk **and** uploads to MinIO; serving is MinIO-first with disk fallback (`lib/server/s3.ts`). The publish-immutable manifest is in Postgres; playback content is served from it.
- **Jobs:** generation job *state* is in Redis (cross-replica create/poll); a dedicated worker consuming a Redis *queue* is optional further hardening (execution currently runs in the receiving web replica via `after()`).
- **TTS pre-generation at publish** (vs on-demand) is still a follow-up: VoxCPM auto-voice is skipped server-side, so narration is synthesized client-side on demand today.

---

## 1. Goals & Constraints

**Scale:** 1000 students initially → up to 8000 registered; ~500 concurrent.

**Roles:**
- **Student** — consumes only. Cannot create/edit courses. Sees only courses assigned to them. Has personal, server-persisted progress.
- **Teacher** — creates, generates, and **publishes** courses; assigns them to student cohorts; tracks student progress. (Beta: the project owner is the sole teacher.)
- **Admin** — manages users, roles, providers, and system config.

**Infra:** **local LLMs only** (no external AI providers), currently a single-box Docker
Compose deployment on one 32GB consumer GPU (see §0). Original target below (§4, §10)
assumed an on-prem K8s cluster with multiple 40–80GB datacenter GPUs (A100/H100/L40S
class) — that remains the scale-up path once cluster infrastructure is available, and the
app/platform layer is already built to run unmodified on either.

**Auth:** Active Directory via LDAP; role from AD group membership; student rosters imported by CSV.

**Beta feature scope:**
- ✅ Slides + AI-teacher TTS narration
- ✅ Quizzes with LLM auto-grading
- ✅ Live chat with the **AI teacher agent only**
- ✅ Local image generation for slide illustrations
- ✅ Persisted chat transcripts (teacher-reviewable)
- ❌ Excluded: classmate agents, whiteboard, interactive sims, PBL, video generation, web search

---

## 2. Current State (why this is a platform build)

Findings from a full codebase read (file refs are in `OpenMAIC/`):

| Concern | Today | Implication |
|---|---|---|
| Auth | `ACCESS_CODE` = one shared site password (HMAC cookie), `middleware.ts` | No identity, no roles. Must replace. |
| Identity | Cosmetic client profile only (`lib/store/user-profile.ts`) | No real users. Must build. |
| Persistence | Source of truth = **browser IndexedDB/Dexie** (`lib/utils/database.ts`). Server only writes course JSON to disk (`lib/server/classroom-storage.ts`) | No shared DB, no per-user data. Must add Postgres + shift source of truth. |
| Enrollment / catalog | None; any UUID is loadable | Must build courses/enrollment model. |
| Progress / analytics | Playback state + quiz answers are browser-local; no teacher visibility | Must add server progress + dashboard. |
| Course sharing | ZIP export/import only | Replace with publish + assign. |
| Scaling | In-memory job `Map` (`lib/server/classroom-job-runner.ts:11`), local-FS media | Blocks multi-replica. Must externalize (Redis + MinIO). |

**Reusable as-is (do not rewrite):** the generation pipeline (`lib/generation/`), multi-agent orchestration/director (`lib/orchestration/`), playback engine (`lib/playback/`), slide/quiz renderers, the `@maic` DSL packages, and — crucially — the **existing server-side course load path** (`app/classroom/[id]` already falls back to fetching a course from the server). That is the foothold for the publish model.

---

## 3. Key Design Principle: pre-generate, then serve static

Our feature set is **playback-heavy, generation-light**. At **publish time** we pre-render the entire course — slide content, illustrations, and TTS audio — and store it immutably. Student playback then serves static JSON + media from object storage.

Consequence: **500 concurrent learners ≈ static asset load**, which web replicas + MinIO handle trivially. GPUs are only exercised by (a) live teacher-agent chat, (b) quiz grading, (c) teacher generation/publish. GPU sizing is therefore driven by *concurrent chat turns* (tens–low hundreds), not by total learners.

---

## 4. Target Architecture

```
                         ┌──────────────────────────────────────────┐
   Students / Teachers   │                Ingress (TLS)             │
        (browser) ──────▶│         (campus network, k8s ingress)    │
                         └───────────────┬──────────────────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────────┐
                 ▼                       ▼                            ▼
        ┌─────────────────┐   ┌────────────────────┐      ┌────────────────────┐
        │  web (Next.js)  │   │  worker (gen jobs) │      │ teacher dashboard  │
        │  N stateless    │   │  Redis-driven      │      │ (role-gated routes │
        │  replicas       │   │  1–2 replicas      │      │  in same app)      │
        └───┬───┬───┬─────┘   └─────┬──────────────┘      └─────────┬──────────┘
            │   │   │               │                               │
            │   │   │               │                               │
   ┌────────┘   │   └───────────┐   │                               │
   ▼            ▼               ▼   ▼                               ▼
┌────────┐ ┌─────────┐  ┌──────────────┐   ┌──────────────────────────────────┐
│Postgres│ │  Redis  │  │ MinIO (S3)   │   │   Model serving (GPU nodes)      │
│ users, │ │ queue + │  │ course media │   │  • vLLM  (text 70B-class)        │
│courses,│ │sessions │  │ (audio,img)  │   │  • VoxCPM2 (TTS)                 │
│progress│ └─────────┘  └──────────────┘   │  • SDXL/Flux (image gen)         │
└────────┘                                  └──────────────────────────────────┘
            ▲
            │ LDAP bind / group lookup
   ┌────────┴─────────┐
   │ Active Directory │  (campus)
   └──────────────────┘
```

**Component responsibilities**
- **web** — Next.js app (forked OpenMAIC). Auth, RBAC, student playback, teacher authoring UI, dashboard. Stateless → horizontally scalable.
- **worker** — runs course generation/publish jobs pulled from Redis (replaces the in-memory `Map`). Talks to vLLM/VoxCPM/image model.
- **Postgres** — system of record (schema §6).
- **Redis** — job queue + server sessions + caches.
- **MinIO** — immutable course media; pods stay ephemeral.
- **Model serving** — vLLM (OpenAI-compatible) for all text; VoxCPM2 for TTS; SDXL/Flux for images. Configured **server-side only** so students never see provider config/keys.

---

## 5. Authentication & Authorization (AD/LDAP)

- **Login:** replace `ACCESS_CODE` middleware with session auth (Auth.js / NextAuth, Credentials→LDAP bind, or a CAS/SAML bridge if preferred later). On success, create a **server session in Redis** carrying `userId`, `role`, `displayName`.
- **Role mapping:** derive role from **AD group membership** (`memberOf`). Config-driven: e.g. `AD_TEACHER_GROUP_DN` → `teacher`; otherwise `student`. Admin via a separate group or explicit allowlist. **Beta shortcut:** allowlist `admin@karunya.edu` as teacher.
- **Provisioning:** auto-provision a `users` row on first successful login (JIT), reconciled against the CSV roster.
- **Enforcement:** middleware injects identity into every request; **API routes enforce role + enrollment server-side** (not just UI hiding). Students calling `generate*` or publish endpoints → 403.
- **Rostering:** teacher uploads a **CSV** (e.g. `email,name,cohort`) in the dashboard → resolves/creates users → populates a cohort → enrollments to the assigned course version.

---

## 6. Data Model (PostgreSQL)

```sql
-- Identity
users(id pk, ad_upn unique, email unique, display_name, role enum('student','teacher','admin'),
      created_at, last_login_at)

-- Courses: immutable published versions
courses(id pk, slug unique, title, description, owner_id fk->users,
        status enum('draft','published','archived'), current_version_id fk->course_versions,
        created_at, updated_at)
course_versions(id pk, course_id fk, version_no int, manifest jsonb,   -- stage + scenes (DSL)
                media_prefix text,                                     -- MinIO key prefix
                published_by fk->users, published_at, immutable bool default true,
                unique(course_id, version_no))

-- Cohorts & assignment
cohorts(id pk, name, owner_id fk->users, created_at)
cohort_members(cohort_id fk, user_id fk, primary key(cohort_id, user_id))
enrollments(id pk, user_id fk, course_id fk, course_version_id fk, cohort_id fk null,
            assigned_at, status enum('assigned','in_progress','completed'),
            unique(user_id, course_id))

-- Per-student learning state (replaces IndexedDB as source of truth)
progress(id pk, user_id fk, course_version_id fk, scene_id text, scene_index int, action_index int,
         status enum('not_started','in_progress','completed'), time_spent_ms bigint,
         updated_at, unique(user_id, course_version_id, scene_id))
quiz_results(id pk, user_id fk, course_version_id fk, scene_id text, question_id text,
             answer_text text, score numeric, max_score numeric, feedback text, graded_at)

-- Chat transcripts (teacher-reviewable)
chat_sessions(id pk, user_id fk, course_version_id fk, scene_id text, started_at, ended_at null)
chat_messages(id pk, session_id fk, role enum('student','teacher_agent'),
              content text, tool_calls jsonb null, created_at)

-- Ops
generation_jobs(id pk, type, status, payload jsonb, result jsonb, error text, created_at, updated_at)
audit_log(id pk, actor_id fk, action, target, metadata jsonb, created_at)
```

Notes: course content stays in the existing `@maic/dsl` shape inside `course_versions.manifest`; media (audio/images) lives in MinIO under `media_prefix`. Published versions are **immutable** — re-publishing creates a new `version_no`; existing enrollments stay pinned to their version.

---

## 7. Course Lifecycle (publish-immutable)

1. **Author (teacher):** generate a course with the existing pipeline (now running against local LLMs). Optionally edit the outline before scene generation.
2. **Pre-render at publish:** generate all scene content + slide images + **TTS audio for every narration line**, upload media to MinIO, write a `course_versions` row (immutable).
3. **Assign:** attach the published version to a cohort (from CSV roster) → creates `enrollments`.
4. **Consume (student):** "My Courses" lists enrolled, published courses. Playback loads the course version from the server (extend the existing `app/classroom/[id]` server path) and serves pre-rendered media. Student progress, quiz results, and chat all persist to Postgres per user.

---

## 8. Local Model Serving

| Capability | Model (as deployed today) | Server | Notes |
|---|---|---|---|
| Text: outline, scene, **teacher chat**, **quiz grading** | **Qwen/Qwen3-32B-AWQ** (int4 AWQ, ~18GB weights) | **vLLM** (OpenAI-compatible), containerized | Sized to fit one 32GB GPU alongside TTS+image; see root `README.md`'s "Local LLM Configuration" for exact tuning and how to size up. On a datacenter-GPU cluster (§1 scale-up path), swap in a larger dense/quality model (e.g. Qwen2.5-72B-Instruct or Llama-3.3-70B-Instruct) — no app code change needed, purely a `MAIC_VLLM_MODEL` + resource change. |
| TTS narration | **VoxCPM2** (OpenBMB) | Containerized, `/v1/audio/speech` | First-class OpenMAIC adapter; run at publish time. |
| Slide images | **SDXL** (Stable Diffusion XL) | Containerized, OpenAI-compatible shim | Run at publish time; store in MinIO. Low-VRAM sequential-offload mode (`IMAGE_LOW_VRAM=1`) trades latency for footprint to coexist with the LLM on one card. |

Wired via OpenMAIC's existing provider abstraction (`lib/ai/`, `server-providers.yml`, `*_BASE_URL`/`DEFAULT_MODEL`). All providers marked **server-configured** so the client never sees keys or provider settings. `ALLOW_LOCAL_NETWORKS=true` for in-cluster URLs.

---

## 9. Feature Gating

- Disable for students: course creation UI (`app/page.tsx`), the MAIC editor (`NEXT_PUBLIC_MAIC_EDITOR_ENABLED=false`), and the settings/provider panels — **plus server-side 403s** on the corresponding APIs.
- Disable globally for beta: video generation, web search, classmate agents, whiteboard, interactive/PBL scene types (don't generate them; hide their renderers).
- Student home becomes **"My Courses"** (server-driven), not the local-IndexedDB recents list.

---

## 10. Kubernetes & Scaling

- **web**: Deployment, N replicas (HPA on CPU/RPS), stateless, behind ingress. Sized for 500 concurrent (mostly static playback + session checks).
- **worker**: Deployment, 1–2 replicas, consumes Redis job queue; node-affinity near GPUs.
- **Postgres**: StatefulSet (or managed) + PVC; backups.
- **Redis**: Deployment/StatefulSet.
- **MinIO**: StatefulSet + PVC (or existing S3).
- **vLLM / VoxCPM / image**: Deployments on GPU nodes (nodeSelector/taints), one Service each.
- **Config/secrets:** ConfigMap for `server-providers.yml`; Secrets for AD bind creds, Postgres, MinIO, session secret.

**Rough sizing (refine via load test):** web 4–8 replicas (1–2 vCPU, 1–2GB each); Postgres 4 vCPU/8GB + fast SSD; MinIO ~1TB; GPUs: 1–2 for the 70B chat/grading pool (continuous batching), 1 for TTS, 1 for image — generation can time-share. Pre-generation removes runtime TTS/image load.

---

## 11. Security & Privacy

- Real per-user auth; server-side RBAC on every mutating/role-sensitive route.
- No AI provider keys reach the browser (all server-configured).
- Student PII (AD identity, progress, transcripts) stays on-prem in Postgres; encrypt at rest; restrict dashboard to teachers/admins; audit access.
- SSRF guard already present for client-supplied URLs; keep local-network allow scoped to server config.

---

## 12. Phased Plan

| Phase | Deliverable | Status |
|---|---|---|
| 0 — Infra & local models | vLLM + VoxCPM + image model up; Postgres/Redis/MinIO; OpenMAIC containerized (Docker Compose today, `deploy/k8s/` ready for a cluster migration); generation works end-to-end on local LLMs. | ✅ deployed |
| 1 — Identity & RBAC | AD/LDAP login, roles, session middleware; creation/settings/editor locked down for students (UI + API 403s). | ✅ dev accounts; LDAP pending AD details |
| 2 — Persistence & publish | Postgres/MinIO course store + Redis job queue; publish-immutable flow; "My Courses"; CSV roster + cohort assignment. | ✅ |
| 3 — Progress & grading | Server-side progress sync from playback engine; quiz result persistence; chat transcript persistence. | ✅ |
| 4 — Teacher dashboard | Enrollment/roster management + analytics (completion, quiz scores, time-on-task, transcript review). | ✅ |
| 5 — Scale hardening | Multi-replica, HPA, load test to 500 concurrent; pre-gen TTS/image optimization; backups/runbooks. | ✅ code; cluster deploy = ops (§13) |

---

## 13. Open Items / Risks

- **Cluster specifics needed for Phase 0:** storage class (RWO/RWX), ingress controller + TLS, GPU node labels/taints, container registry, AD host/baseDN/bind account + exact faculty group DN.
- **Fork vs. patch upstream:** we keep our additions (`docs/`, `deploy/`) at the workspace root, separate from `OpenMAIC/`, to ease pulling upstream updates; unavoidable code changes live inside `OpenMAIC/` and should be kept as cohesive, well-labeled modules.
- **Upstream drift:** OpenMAIC is actively developed; pin a version/tag and schedule periodic merges.
- **Playback source-of-truth shift:** moving from IndexedDB to server requires careful changes in the playback/quiz/chat hooks; isolate behind a storage interface to limit blast radius.
- **Model quality on local LLMs:** validate generation quality early (Phase 0 exit criterion) before building the platform on top.
