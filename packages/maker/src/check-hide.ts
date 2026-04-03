import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, categories } from "@genus/db";
import { eq } from "drizzle-orm";

const cats = await db.select({ name: categories.name, slug: categories.slug, hideLabels: categories.hideLabels }).from(categories).where(eq(categories.hideLabels, true));
for (const c of cats) console.log(`${c.name} (${c.slug}) — hideLabels: ${c.hideLabels}`);
console.log(`Total: ${cats.length}`);
process.exit(0);
