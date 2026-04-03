import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories } from "@genus/db";
import { eq } from "drizzle-orm";

const renames: Record<string, string> = {
  // Animal pool — make titles feel like fun quiz clues
  "australian-animals": "Only in Australia!",
  "african-animals": "Only in Africa!",
  "massive-animals": "Heavier Than You!",
  "tiny-creatures": "Fits in Your Hand",
  "ocean-animals": "Lives Underwater",
  "carnivores": "Meat Eaters!",
  "herbivores": "Plant Eaters Only",
  "mammals-pool": "Feeds Milk to Babies",
  "birds-pool": "Has Feathers",
  "reptiles": "Cold-Blooded & Scaly",
  "insects": "Has 6 Legs",
  "amphibians": "Land AND Water",
  "desert-animals": "Desert Dwellers",
  "nocturnal": "Only Comes Out at Night",
  "striped-animals": "Wears Stripes",
  "spotted-animals": "Covered in Spots",
  "endangered-pool": "Going Extinct!",
  // Landmarks
  "european-landmarks": "Found in Europe",
  "asian-landmarks": "Found in Asia",
  // Companies
  "american-companies": "Made in America",
  "european-companies": "Made in Europe",
  "japanese-companies": "Made in Japan",
};

async function main() {
  console.log("\n=== Renaming Categories ===\n");

  for (const [slug, newName] of Object.entries(renames)) {
    const result = await db
      .update(categories)
      .set({ name: newName })
      .where(eq(categories.slug, slug))
      .returning({ id: categories.id, name: categories.name });

    if (result.length > 0) {
      console.log(`  ${slug} → "${newName}"`);
    } else {
      console.log(`  [SKIP] ${slug} — not found`);
    }
  }

  console.log("\n=== Done! ===\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
