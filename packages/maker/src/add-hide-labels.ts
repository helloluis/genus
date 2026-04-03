import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db } from "@genus/db";
import { sql } from "drizzle-orm";

await db.execute(sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS hide_labels boolean NOT NULL DEFAULT false`);
console.log("Column added");

const slugs = ["golden-retriever", "dalmatian", "shiba-inu", "poodle", "german-shepherd", "bulldog", "husky"];
for (const slug of slugs) {
  await db.execute(sql`UPDATE categories SET hide_labels = true WHERE slug = ${slug}`);
  console.log(`  ${slug} → hideLabels=true`);
}

process.exit(0);
