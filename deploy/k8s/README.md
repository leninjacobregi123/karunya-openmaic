# OpenMAIC on Kubernetes (Karunya) — production migration

Parameterized manifests for the production deployment. Everything marked `REPLACE_ME`
needs a cluster-specific value (these are the `feat-005` prerequisites).

## Files (apply in order)

| File | What |
|---|---|
| `00-namespace-config.yaml` | namespace, ConfigMap, Secret (fill REPLACE_ME) |
| `20-data.yaml` | Postgres + Redis + MinIO (StatefulSets/PVCs; set `storageClassName`) |
| `40-models.yaml` | vLLM (text), VoxCPM (TTS), SDXL (image) on GPU nodes |
| `30-web.yaml` | Next.js web (Deployment + Service + HPA) + worker |
| `50-ingress.yaml` | TLS ingress → web |

```bash
# build & push the app image first (from OpenMAIC/):
docker build -t REGISTRY/openmaic:latest OpenMAIC && docker push REGISTRY/openmaic:latest
kubectl apply -f deploy/k8s/00-namespace-config.yaml
kubectl apply -f deploy/k8s/20-data.yaml
kubectl apply -f deploy/k8s/40-models.yaml
kubectl apply -f deploy/k8s/30-web.yaml
kubectl apply -f deploy/k8s/50-ingress.yaml
# run DB migrations once (job or one-off):
kubectl -n openmaic exec deploy/web -- sh -lc 'DATABASE_URL=$DATABASE_URL pnpm exec drizzle-kit migrate'
```

## REPLACE_ME values needed (feat-005)

- **storageClassName** (Postgres/MinIO PVCs); RWO is sufficient.
- **container registry** for the app + model-server images.
- **GPU**: node label (`REPLACE_ME_gpu_label`) + GPU resource name (`REPLACE_ME/gpu`, e.g. `nvidia.com/gpu`) + tolerations if GPU nodes are tainted.
- **ingress**: class, hostname, TLS issuer/secret.
- **AD/LDAP**: URL, base DN, bind DN/password, faculty group DN (ConfigMap/Secret).
- secret passwords: SESSION_SECRET, Postgres, MinIO, S3 secret.

## Multi-replica status (DONE)

The web tier is now stateless and **safe to run with `web.replicas > 1`** (given shared
Postgres + Redis + MinIO, which these manifests provide):

1. ✅ **Playback content from Postgres** — `/api/classroom` serves published courses from
   `course_versions.manifest` (PG-first, disk fallback). No pod-local dependency.
2. ✅ **Media on MinIO** — generation uploads images/audio to MinIO; `/api/classroom-media`
   serves MinIO-first (disk fallback). Run `deploy/migrate-media-to-minio.mjs` once to move
   any pre-existing on-disk media into MinIO.
3. ✅ **Generation job state on Redis** — `classroom-job-store` is Redis-backed, so
   create/poll work across replicas.

Auth (signed-cookie sessions) and the chat SSE path were already stateless.

**Optional further hardening:** a dedicated `worker` Deployment consuming a Redis job
*queue* (currently job execution runs in the web replica that received the request, via
`after()`, and writes shared state to Redis — correct for the single-teacher beta).

## Sizing (from dev load test — see docs/karunya-architecture.md / progress.md)

- Playback is static-serving + a cheap enrollment check (no LLM). A single **dev** replica
  sustained ~130 req/s with **0 errors** to 500 concurrent; a production build + several
  web replicas comfortably covers 500 concurrent students (who load once then read for
  minutes, not 500 req/s sustained).
- GPU load at runtime = live chat + quiz grading only (TTS/images pre-generated at publish).
  Size vLLM for concurrent chat turns (tens–low hundreds), not total students.

## Backups / ops

- Postgres: scheduled `pg_dump` (CronJob) → object storage; it holds all users, courses,
  enrollments, progress, quiz results, transcripts.
- MinIO: bucket replication or volume snapshots for course media.
- Config/secrets in Git-ignored values or a sealed-secrets/Vault setup.
