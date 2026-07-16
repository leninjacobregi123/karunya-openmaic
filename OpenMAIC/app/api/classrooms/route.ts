import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { CLASSROOMS_DIR, readClassroom } from '@/lib/server/classroom-storage';

/**
 * List generated classrooms persisted on disk (publish sources for teachers).
 * Single-teacher beta: no per-classroom ownership filter yet.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
    return NextResponse.json({ success: false, error: 'Teachers only' }, { status: 403 });
  }
  let files: string[] = [];
  try {
    files = await fs.readdir(CLASSROOMS_DIR);
  } catch {
    files = [];
  }
  const ids = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const classrooms: Array<{ id: string; name: string; scenes: number; createdAt: string }> = [];
  for (const id of ids) {
    const c = await readClassroom(id);
    if (c) {
      classrooms.push({
        id,
        name: c.stage?.name || 'Untitled',
        scenes: (c.scenes || []).length,
        createdAt: c.createdAt,
      });
    }
  }
  classrooms.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return NextResponse.json({ success: true, classrooms });
}
