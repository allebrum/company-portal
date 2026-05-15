import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env, isProd } from '../env.js';
import * as schema from './schema.js';

const requireTls = isProd || env.DATABASE_URL.includes('sslmode=require');

export const sqlClient = postgres(env.DATABASE_URL, {
  ssl: requireTls ? 'require' : false,
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sqlClient, { schema });
export { schema };
export type DB = typeof db;
