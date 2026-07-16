/**
 * Drizzle/Postgres client (singleton). Connection string from DATABASE_URL.
 * Reuses one Pool across Next.js dev hot-reloads via a global.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://maic:maic_dev_pw@localhost:5433/maic';

const globalForDb = globalThis as unknown as { _pgPool?: Pool };

const pool = globalForDb._pgPool ?? new Pool({ connectionString: DATABASE_URL });
if (process.env.NODE_ENV !== 'production') globalForDb._pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
