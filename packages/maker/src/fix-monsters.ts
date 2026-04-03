import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories, selections } from "@genus/db";
import { eq, inArray } from "drizzle-orm";

// Delete 'Has Claws or Teeth' and '80s Horror Icons'
const toDelete = ["claws-or-teeth", "80s-horror"];
const cats = await db.select().from(categories).where(inArray(categories.slug, toDelete));
for (const c of cats) {
  await db.delete(selections).where(eq(selections.categoryId, c.id));
  await db.delete(categories).where(eq(categories.id, c.id));
  console.log("Deleted:", c.name);
}

// Rename 'Classic Monsters' → 'Over 100 Years Old!'
const result = await db
  .update(categories)
  .set({ name: "Over 100 Years Old!" })
  .where(eq(categories.slug, "classic-monsters"))
  .returning();
console.log("Renamed:", result.length ? result[0].name : "not found");

process.exit(0);
