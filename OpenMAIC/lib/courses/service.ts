/**
 * Course/enrollment service (Phase 2). Postgres is the source of truth for
 * courses, immutable published versions, cohorts and enrollments. Media is
 * reused from the generated classroom's on-disk dir (served by
 * /api/classroom-media); moving media to MinIO is a later hardening step.
 */
import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import {
  courses,
  courseVersions,
  cohorts,
  cohortMembers,
  enrollments,
  users,
} from '@/lib/db/schema';
import { readClassroom } from '@/lib/server/classroom-storage';
import type { SessionUser } from '@/lib/auth/types';

// Dev-only default password for roster-provisioned students (no AD yet).
const ROSTER_DEFAULT_PASSWORD = process.env.ROSTER_DEFAULT_PASSWORD || 'student123';

function slugify(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'course';
  return `${base}-${nanoid(6)}`;
}

/** Snapshot a generated classroom into an immutable published course (version 1). */
export async function publishCourse(opts: {
  ownerId: string;
  classroomId: string;
  title?: string;
  description?: string;
}) {
  const persisted = await readClassroom(opts.classroomId);
  if (!persisted) throw new Error(`Classroom ${opts.classroomId} not found`);

  const title = opts.title || persisted.stage?.name || 'Untitled course';
  const [course] = await db
    .insert(courses)
    .values({
      slug: slugify(title),
      title,
      description: opts.description ?? persisted.stage?.description ?? null,
      ownerId: opts.ownerId,
      status: 'published',
    })
    .returning();

  const [version] = await db
    .insert(courseVersions)
    .values({
      courseId: course.id,
      versionNo: 1,
      manifest: { stage: persisted.stage, scenes: persisted.scenes },
      sourceClassroomId: opts.classroomId,
      publishedBy: opts.ownerId,
    })
    .returning();

  return { course, version };
}

export async function listCoursesForTeacher(ownerId: string) {
  const owned = await db.select().from(courses).where(eq(courses.ownerId, ownerId));
  if (owned.length === 0) return [];
  const versions = await db
    .select()
    .from(courseVersions)
    .where(
      inArray(
        courseVersions.courseId,
        owned.map((c) => c.id),
      ),
    );
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    const cur = latest.get(v.courseId);
    if (!cur || v.versionNo > cur.versionNo) latest.set(v.courseId, v);
  }
  return owned.map((c) => ({
    courseId: c.id,
    title: c.title,
    description: c.description,
    status: c.status,
    slug: c.slug,
    classroomId: latest.get(c.id)?.sourceClassroomId ?? null,
    versionId: latest.get(c.id)?.id ?? null,
  }));
}

export async function listCoursesForStudent(userId: string) {
  const rows = await db
    .select({
      courseId: courses.id,
      title: courses.title,
      description: courses.description,
      classroomId: courseVersions.sourceClassroomId,
      versionId: courseVersions.id,
      status: enrollments.status,
    })
    .from(enrollments)
    .innerJoin(courseVersions, eq(enrollments.courseVersionId, courseVersions.id))
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(eq(enrollments.userId, userId));
  return rows;
}

/**
 * Published course content (DSL manifest) by playback classroom id, latest version.
 * Lets playback serve from Postgres instead of pod-local disk (stateless replicas).
 */
export async function getPublishedManifest(
  classroomId: string,
): Promise<{ id: string; stage: unknown; scenes: unknown[] } | null> {
  const rows = await db
    .select({ manifest: courseVersions.manifest })
    .from(courseVersions)
    .where(eq(courseVersions.sourceClassroomId, classroomId))
    .orderBy(desc(courseVersions.versionNo))
    .limit(1);
  const m = rows[0]?.manifest as { stage?: unknown; scenes?: unknown[] } | undefined;
  if (!m || !m.stage) return null;
  return { id: classroomId, stage: m.stage, scenes: m.scenes ?? [] };
}

/** Access check for playback by source classroom id. */
export async function canAccessClassroom(user: SessionUser, classroomId: string): Promise<boolean> {
  if (user.role === 'teacher' || user.role === 'admin') return true;
  const rows = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(courseVersions, eq(enrollments.courseVersionId, courseVersions.id))
    .where(and(eq(enrollments.userId, user.id), eq(courseVersions.sourceClassroomId, classroomId)))
    .limit(1);
  return rows.length > 0;
}

export async function listCohorts(ownerId: string) {
  const cs = await db.select().from(cohorts).where(eq(cohorts.ownerId, ownerId));
  if (cs.length === 0) return [];
  const counts = await db
    .select({ cohortId: cohortMembers.cohortId, n: sql<number>`count(*)` })
    .from(cohortMembers)
    .where(
      inArray(
        cohortMembers.cohortId,
        cs.map((c) => c.id),
      ),
    )
    .groupBy(cohortMembers.cohortId);
  const m = new Map(counts.map((r) => [r.cohortId, Number(r.n)]));
  return cs.map((c) => ({ id: c.id, name: c.name, members: m.get(c.id) ?? 0 }));
}

export async function createCohort(opts: { ownerId: string; name: string }) {
  const [cohort] = await db
    .insert(cohorts)
    .values({ name: opts.name, ownerId: opts.ownerId })
    .returning();
  return cohort;
}

/** Add students to a cohort by email; provision missing dev accounts. */
export async function addRosterByEmails(cohortId: string, emails: string[]) {
  const normalized = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  let created = 0;
  let added = 0;
  for (const email of normalized) {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let user = rows[0];
    if (!user) {
      const name = email.split('@')[0];
      [user] = await db
        .insert(users)
        .values({
          email,
          name,
          role: 'student',
          passwordHash: bcrypt.hashSync(ROSTER_DEFAULT_PASSWORD, 10),
        })
        .returning();
      created++;
    }
    await db
      .insert(cohortMembers)
      .values({ cohortId, userId: user.id })
      .onConflictDoNothing({ target: [cohortMembers.cohortId, cohortMembers.userId] });
    added++;
  }
  return { added, created, total: normalized.length };
}

/** Enroll every cohort member into a published course version. */
export async function assignCourseToCohort(opts: {
  courseId: string;
  courseVersionId: string;
  cohortId: string;
}) {
  const members = await db
    .select({ userId: cohortMembers.userId })
    .from(cohortMembers)
    .where(eq(cohortMembers.cohortId, opts.cohortId));
  let enrolled = 0;
  for (const m of members) {
    await db
      .insert(enrollments)
      .values({
        userId: m.userId,
        courseId: opts.courseId,
        courseVersionId: opts.courseVersionId,
        cohortId: opts.cohortId,
      })
      .onConflictDoNothing({ target: [enrollments.userId, enrollments.courseId] });
    enrolled++;
  }
  return { enrolled };
}
