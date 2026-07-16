// One-off: upload existing on-disk classroom media (data/classrooms/*/{media,audio})
// to MinIO so multi-replica serving works for already-generated courses.
// Run from OpenMAIC/:  node ../deploy/migrate-media-to-minio.mjs
import * as Minio from 'minio';
import { promises as fs } from 'fs';
import path from 'path';

const u = new URL(process.env.S3_ENDPOINT || 'http://localhost:9000');
const c = new Minio.Client({
  endPoint: u.hostname,
  port: Number(u.port || 9000),
  useSSL: u.protocol === 'https:',
  accessKey: process.env.S3_ACCESS_KEY || 'maic',
  secretKey: process.env.S3_SECRET_KEY || 'maic_dev_pw',
});
const BUCKET = process.env.S3_BUCKET || 'maic-media';
if (!(await c.bucketExists(BUCKET))) await c.makeBucket(BUCKET);

const ROOT = 'data/classrooms';
let n = 0;
for (const id of await fs.readdir(ROOT).catch(() => [])) {
  const base = path.join(ROOT, id);
  if (!(await fs.stat(base).catch(() => null))?.isDirectory()) continue;
  for (const sub of ['media', 'audio']) {
    const dir = path.join(base, sub);
    for (const f of await fs.readdir(dir).catch(() => [])) {
      const buf = await fs.readFile(path.join(dir, f));
      await c.putObject(BUCKET, `classrooms/${id}/${sub}/${f}`, buf, buf.length);
      n++;
    }
  }
}

// Probe object that does NOT exist on disk → fetching it via /api/classroom-media
// proves the route serves from MinIO (not the disk fallback). 1x1 PNG.
const probe = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000020001f4a2db6c0000000049454e44ae426082',
  'hex',
);
await c.putObject(BUCKET, 'classrooms/dpd_r20zDT/media/_minio_probe.png', probe, probe.length, {
  'Content-Type': 'image/png',
});
console.log(`migrated ${n} media objects + 1 probe to bucket ${BUCKET}`);
