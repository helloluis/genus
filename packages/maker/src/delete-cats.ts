import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories, selections } from "@genus/db";
import { eq, inArray, sql } from "drizzle-orm";

const toDelete = ["world-leaders-g7-2024", "striped-animals"];
const cats = await db.select().from(categories).where(inArray(categories.slug, toDelete));
for (const c of cats) {
  await db.execute(sql`DELETE FROM rounds WHERE category_id = ${c.id}`);
  await db.delete(selections).where(eq(selections.categoryId, c.id));
  await db.delete(categories).where(eq(categories.id, c.id));
  console.log("Deleted:", c.name);
}
process.exit(0);
