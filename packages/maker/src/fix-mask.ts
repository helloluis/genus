import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories, selections } from "@genus/db";
import { eq, and } from "drizzle-orm";

// Find the "Wears a Mask" category
const [maskCat] = await db.select().from(categories).where(eq(categories.slug, "wears-a-mask"));
console.log("Category:", maskCat.name, "id:", maskCat.id);

// Check if Predator exists as a selection
const predator = await db.select().from(selections).where(
  and(eq(selections.categoryId, maskCat.id), eq(selections.label, "Predator"))
);

if (predator.length > 0) {
  // Flip to correct
  await db.update(selections).set({ isCorrect: true }).where(eq(selections.id, predator[0].id));
  console.log("Predator flipped to correct (was isCorrect=" + predator[0].isCorrect + ")");
} else {
  console.log("Predator not found in this category");
}

process.exit(0);
