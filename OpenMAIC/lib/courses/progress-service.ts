/**
 * Phase 3 — per-student progress, quiz results, and chat transcripts, plus the
 * teacher-facing aggregations the dashboard reads. Records are attributed to the
 * student's enrolled course version (resolved from the playback classroom id).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  enrollments,
  courses,
  courseVersions,
  progress,
  quizResults,
  chatMessages,
  users,
} from '@/lib/db/schema';
import type { SessionUser } from '@/lib/auth/types';

/** The course version a student is enrolled in for a given playback classroom id. */
export async function resolveStudentCourseVersion(
  userId: string,
  classroomId: string,
): Promise<string | null> {
  const rows = await db
    .select({ vId: courseVersions.id })
    .from(enrollments)
    .innerJoin(courseVersions, eq(enrollments.courseVersionId, courseVersions.id))
    .where(and(eq(enrollments.userId, userId), eq(courseVersions.sourceClassroomId, classroomId)))
    .limit(1);
  return rows[0]?.vId ?? null;
}

export async function recordProgress(
  user: SessionUser,
  p: {
    classroomId: string;
    sceneId: string;
    sceneIndex?: number;
    actionIndex?: number;
    status?: 'in_progress' | 'completed';
    timeSpentMs?: number;
  },
) {
  if (user.role !== 'student') return { recorded: false, reason: 'not-student' as const };
  const vId = await resolveStudentCourseVersion(user.id, p.classroomId);
  if (!vId) return { recorded: false, reason: 'not-enrolled' as const };
  await db
    .insert(progress)
    .values({
      userId: user.id,
      courseVersionId: vId,
      sceneId: p.sceneId,
      sceneIndex: p.sceneIndex ?? 0,
      actionIndex: p.actionIndex ?? 0,
      status: p.status ?? 'in_progress',
      timeSpentMs: p.timeSpentMs ?? 0,
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.courseVersionId, progress.sceneId],
      set: {
        sceneIndex: p.sceneIndex ?? 0,
        actionIndex: p.actionIndex ?? 0,
        status: p.status ?? 'in_progress',
        timeSpentMs: sql`${progress.timeSpentMs} + ${p.timeSpentMs ?? 0}`,
        updatedAt: new Date(),
      },
    });
  return { recorded: true as const };
}

export async function recordQuizResult(
  user: SessionUser,
  q: {
    classroomId: string;
    sceneId: string;
    questionId?: string;
    answerText?: string;
    score?: number;
    maxScore?: number;
    feedback?: string;
  },
) {
  if (user.role !== 'student') return { recorded: false };
  const vId = await resolveStudentCourseVersion(user.id, q.classroomId);
  if (!vId) return { recorded: false };
  await db.insert(quizResults).values({
    userId: user.id,
    courseVersionId: vId,
    sceneId: q.sceneId,
    questionId: q.questionId,
    answerText: q.answerText,
    score: q.score,
    maxScore: q.maxScore,
    feedback: q.feedback,
  });
  return { recorded: true };
}

export async function recordChatMessage(
  user: SessionUser,
  c: { classroomId: string; sceneId?: string; role: 'student' | 'teacher_agent'; content: string },
) {
  if (user.role !== 'student') return { recorded: false };
  const vId = await resolveStudentCourseVersion(user.id, c.classroomId);
  if (!vId) return { recorded: false };
  await db.insert(chatMessages).values({
    userId: user.id,
    courseVersionId: vId,
    sceneId: c.sceneId,
    role: c.role,
    content: c.content,
  });
  return { recorded: true };
}

/** Teacher dashboard: per-student completion + quiz summary for a course. */
export async function getCourseProgress(courseId: string) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) return null;
  const [version] = await db
    .select()
    .from(courseVersions)
    .where(eq(courseVersions.courseId, courseId))
    .orderBy(desc(courseVersions.versionNo))
    .limit(1);
  const manifest = version?.manifest as { scenes?: unknown[] } | undefined;
  const totalScenes = manifest?.scenes?.length ?? 0;
  const vId = version?.id;

  const enrolled = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      status: enrollments.status,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(eq(enrollments.courseId, courseId));

  const progAgg = vId
    ? await db
        .select({
          userId: progress.userId,
          completed: sql<number>`count(*) filter (where ${progress.status} = 'completed')`,
          lastActivity: sql<string>`max(${progress.updatedAt})`,
        })
        .from(progress)
        .where(eq(progress.courseVersionId, vId))
        .groupBy(progress.userId)
    : [];
  const quizAgg = vId
    ? await db
        .select({
          userId: quizResults.userId,
          avgPct: sql<number>`avg(case when ${quizResults.maxScore} > 0 then ${quizResults.score} / ${quizResults.maxScore} else null end)`,
          count: sql<number>`count(*)`,
        })
        .from(quizResults)
        .where(eq(quizResults.courseVersionId, vId))
        .groupBy(quizResults.userId)
    : [];

  const pMap = new Map(progAgg.map((r) => [r.userId, r]));
  const qMap = new Map(quizAgg.map((r) => [r.userId, r]));

  return {
    course: { id: course.id, title: course.title },
    totalScenes,
    students: enrolled.map((e) => {
      const q = qMap.get(e.userId);
      return {
        userId: e.userId,
        name: e.name,
        email: e.email,
        enrollmentStatus: e.status,
        scenesCompleted: Number(pMap.get(e.userId)?.completed ?? 0),
        totalScenes,
        lastActivity: pMap.get(e.userId)?.lastActivity ?? null,
        quizCount: Number(q?.count ?? 0),
        quizAvgPct: q?.avgPct != null ? Math.round(Number(q.avgPct) * 100) : null,
      };
    }),
  };
}

/** Teacher dashboard: a single student's chat transcript for a course. */
export async function getStudentTranscript(courseId: string, userId: string) {
  const versions = await db
    .select({ id: courseVersions.id })
    .from(courseVersions)
    .where(eq(courseVersions.courseId, courseId));
  if (versions.length === 0) return [];
  const vIds = versions.map((v) => v.id);
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), inArray(chatMessages.courseVersionId, vIds)))
    .orderBy(chatMessages.createdAt);
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    sceneId: r.sceneId,
    createdAt: r.createdAt,
  }));
}
