import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
import { db } from "@genus/db";
import { sql } from "drizzle-orm";

// Delete duplicate questions, keep the one with lowest id
await db.execute(sql`
  DELETE FROM questions a USING questions b
  WHERE a.id > b.id
    AND a.pool = b.pool
    AND a.correct_tag = b.correct_tag
`);

const r = await db.execute(sql`SELECT count(*) as cnt FROM questions`);
console.log(`Questions after dedup: ${(r as any)[0].cnt}`);
process.exit(0);
