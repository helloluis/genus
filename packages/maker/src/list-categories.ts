import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories, selections } from "@genus/db";
import { eq, sql } from "drizzle-orm";

const cats = await db
  .select({
    id: categories.id,
    name: categories.name,
    slug: categories.slug,
    correct: sql<number>`count(*) filter (where ${selections.isCorrect} = true)`,
    total: sql<number>`count(*)`,
  })
  .from(categories)
  .leftJoin(selections, eq(categories.id, selections.categoryId))
  .groupBy(categories.id, categories.name, categories.slug)
  .orderBy(categories.id);

for (const c of cats) {
  console.log(`${c.id} | ${c.name} (${c.slug}) — ${c.correct} correct / ${c.total} total`);
}
process.exit(0);
