/**
 * MinIO/S3 client for shared course media (multi-replica). Media keys mirror the
 * on-disk layout: classrooms/{classroomId}/{media|audio}/{filename}.
 */
import * as Minio from 'minio';
import type { Readable } from 'stream';

const g = globalThis as unknown as { _minio?: Minio.Client };

function endpoint() {
  const u = new URL(process.env.S3_ENDPOINT || 'http://localhost:9000');
  return {
    endPoint: u.hostname,
    port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
    useSSL: u.protocol === 'https:',
  };
}

export const S3_BUCKET = process.env.S3_BUCKET || 'maic-media';

export function getS3(): Minio.Client {
  if (!g._minio) {
    const { endPoint, port, useSSL } = endpoint();
    g._minio = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey: process.env.S3_ACCESS_KEY || 'maic',
      secretKey: process.env.S3_SECRET_KEY || 'maic_dev_pw',
    });
  }
  return g._minio;
}

let _ensured = false;
async function ensureBucket() {
  if (_ensured) return;
  const c = getS3();
  try {
    if (!(await c.bucketExists(S3_BUCKET))) await c.makeBucket(S3_BUCKET);
  } catch {
    /* bucket may already exist / race */
  }
  _ensured = true;
}

export function mediaKey(classroomId: string, subPath: string): string {
  return `classrooms/${classroomId}/${subPath}`;
}

export async function putMedia(key: string, body: Buffer, contentType?: string): Promise<void> {
  await ensureBucket();
  await getS3().putObject(
    S3_BUCKET,
    key,
    body,
    body.length,
    contentType ? { 'Content-Type': contentType } : undefined,
  );
}

export async function statMedia(key: string): Promise<{ size: number } | null> {
  try {
    const s = await getS3().statObject(S3_BUCKET, key);
    return { size: s.size };
  } catch {
    return null;
  }
}

export async function getMediaStream(key: string): Promise<Readable | null> {
  try {
    return await getS3().getObject(S3_BUCKET, key);
  } catch {
    return null;
  }
}
