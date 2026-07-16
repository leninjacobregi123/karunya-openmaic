/**
 * Dev seed: create local accounts so we can exercise auth/RBAC before AD is wired.
 * Idempotent (ON CONFLICT DO NOTHING by email). Run: pnpm tsx lib/db/seed.ts
 * Dev passwords only — do not use in production.
 */
import bcrypt from 'bcryptjs';
import { db } from './client';
import { users, type UserRole } from './schema';

const DEV_USERS: Array<{ email: string; name: string; role: UserRole; pw: string }> = [
  { email: 'admin@karunya.edu', name: 'Admin Teacher', role: 'teacher', pw: 'teacher123' },
  { email: 'student1@karunya.edu', name: 'Test Student One', role: 'student', pw: 'student123' },
  { email: 'student2@karunya.edu', name: 'Test Student Two', role: 'student', pw: 'student123' },
];

async function main() {
  for (const u of DEV_USERS) {
    await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: bcrypt.hashSync(u.pw, 10),
      })
      .onConflictDoNothing({ target: users.email });
  }
  const all = await db.select().from(users);
  console.log('seeded users:', all.map((u) => `${u.email} (${u.role})`).join(', '));
  process.exit(0);
}

main().catch((e) => {
  console.error('seed failed:', e);
  process.exit(1);
});
