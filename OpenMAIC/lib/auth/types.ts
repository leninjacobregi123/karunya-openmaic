/** Auth domain types. Shared by edge (middleware) and node (route handlers). */
export type Role = 'student' | 'teacher' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Pluggable credential verifier. DevAccountsProvider (local DB accounts) now;
 * an LdapProvider (AD bind + group->role mapping) drops in later via AUTH_MODE.
 */
export interface AuthProvider {
  verifyCredentials(email: string, password: string): Promise<SessionUser | null>;
}
