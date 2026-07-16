/** Dev-mode credential verifier: local accounts in Postgres (bcrypt). Node-only. */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import type { AuthProvider, SessionUser } from '../types';

export class DevAccountsProvider implements AuthProvider {
  async verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
    const normalized = email.toLowerCase().trim();
    const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
    const u = rows[0];
    if (!u || !u.passwordHash) return null;
    if (!bcrypt.compareSync(password, u.passwordHash)) return null;
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }
}
