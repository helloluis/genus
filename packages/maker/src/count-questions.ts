import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
import { db } from "@genus/db";
import { sql } from "drizzle-orm";

const r = await db.execute(sql`SELECT pool, count(*) as cnt FROM questions GROUP BY pool ORDER BY pool`);
let total = 0;
for (const row of r as any) { console.log(`${row.pool}: ${row.cnt}`); total += Number(row.cnt); }
console.log(`Total: ${total}`);

// Show some samples
const samples = await db.execute(sql`SELECT text, pool, correct_tag FROM questions ORDER BY random() LIMIT 15`);
console.log("\nSample questions:");
for (const s of samples as any) console.log(`  [${s.pool}] "${s.text}" → tag: ${s.correct_tag}`);

process.exit(0);
