import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db } from "@genus/db";
import { sql } from "drizzle-orm";

const samples = await db.execute(sql`SELECT pool, label, tags FROM pool_items ORDER BY random() LIMIT 15`);
for (const r of samples as any) {
  const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
  console.log(`[${r.pool}] ${r.label}: ${tags.join(', ')}`);
}
process.exit(0);
