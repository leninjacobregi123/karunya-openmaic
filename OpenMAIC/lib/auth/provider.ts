/** Selects the active AuthProvider by AUTH_MODE. 'dev' now; 'ldap' (AD) later. */
import type { AuthProvider } from './types';
import { DevAccountsProvider } from './providers/dev-accounts';

let _provider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (_provider) return _provider;
  const mode = (process.env.AUTH_MODE || 'dev').toLowerCase();
  switch (mode) {
    // case 'ldap': _provider = new LdapProvider(); break;  // wired when AD details arrive
    case 'dev':
    default:
      _provider = new DevAccountsProvider();
  }
  return _provider;
}
