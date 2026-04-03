import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://genus:genus_dev@localhost:5432/genus";
    _client = postgres(connectionString);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/** Shorthand — same as getDb() but matches the old `db` export name */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export * from "./schema.js";
export { schema };
