/**
 * Karunya platform database schema (Drizzle / PostgreSQL).
 *
 * Phase 1 introduces identity only (users + roles). Courses, enrollments,
 * progress, quiz results, and chat transcripts arrive in Phase 2/3 — added as
 * new tables + incremental migrations. See docs/karunya-architecture.md §6.
 *
 * This is additive platform code layered on top of upstream OpenMAIC.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  integer,
  jsonb,
  unique,
  primaryKey,
  real,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['student', 'teacher', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('student'),
  // Dev-mode local accounts store a bcrypt hash; AD/LDAP users have null here.
  passwordHash: text('password_hash'),
  // AD userPrincipalName for directory-backed accounts (wired in the LdapProvider later).
  adUpn: text('ad_upn').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];

// ─────────────────────────── Phase 2: courses & enrollment ───────────────────

export const courseStatus = pgEnum('course_status', ['draft', 'published', 'archived']);
export const enrollmentStatus = pgEnum('enrollment_status', [
  'assigned',
  'in_progress',
  'completed',
]);

export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  status: courseStatus('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable published snapshots. manifest = { stage, scenes } (the DSL course). */
export const courseVersions = pgTable(
  'course_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    versionNo: integer('version_no').notNull(),
    manifest: jsonb('manifest').notNull(),
    // Source generated-classroom id whose on-disk media (/api/classroom-media) this version reuses.
    sourceClassroomId: text('source_classroom_id'),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ courseVersionUq: unique().on(t.courseId, t.versionNo) }),
);

export const cohorts = pgTable('cohorts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cohortMembers = pgTable(
  'cohort_members',
  {
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cohortId, t.userId] }) }),
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    cohortId: uuid('cohort_id').references(() => cohorts.id),
    status: enrollmentStatus('status').notNull().default('assigned'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userCourseUq: unique().on(t.userId, t.courseId) }),
);

export type Course = typeof courses.$inferSelect;
export type CourseVersion = typeof courseVersions.$inferSelect;
export type Cohort = typeof cohorts.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;

// ─────────────────── Phase 3: progress, grading, transcripts ─────────────────

export const progressStatus = pgEnum('progress_status', [
  'not_started',
  'in_progress',
  'completed',
]);

/** Per-student, per-scene progress. One row per (user, courseVersion, scene). */
export const progress = pgTable(
  'progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    sceneId: text('scene_id').notNull(),
    sceneIndex: integer('scene_index').notNull().default(0),
    actionIndex: integer('action_index').notNull().default(0),
    status: progressStatus('status').notNull().default('in_progress'),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ progressUq: unique().on(t.userId, t.courseVersionId, t.sceneId) }),
);

/** One row per graded quiz answer (append-only; latest attempt wins in reports). */
export const quizResults = pgTable('quiz_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  courseVersionId: uuid('course_version_id')
    .notNull()
    .references(() => courseVersions.id),
  sceneId: text('scene_id').notNull(),
  questionId: text('question_id'),
  answerText: text('answer_text'),
  score: real('score'),
  maxScore: real('max_score'),
  feedback: text('feedback'),
  gradedAt: timestamp('graded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatRole = pgEnum('chat_role', ['student', 'teacher_agent']);

/** Chat transcript lines (student questions + AI-teacher replies) for teacher review. */
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  courseVersionId: uuid('course_version_id')
    .notNull()
    .references(() => courseVersions.id),
  sceneId: text('scene_id'),
  role: chatRole('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProgressRow = typeof progress.$inferSelect;
export type QuizResult = typeof quizResults.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
