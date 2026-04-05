import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db } from "@genus/db";
import { sql } from "drizzle-orm";

// Create new tables
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS pool_items (
    id SERIAL PRIMARY KEY,
    pool TEXT NOT NULL,
    label TEXT NOT NULL,
    image_url TEXT,
    image_status TEXT NOT NULL DEFAULT 'pending',
    tags JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
console.log("Created pool_items table");

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    pool TEXT NOT NULL,
    correct_tag TEXT NOT NULL,
    hide_labels BOOLEAN NOT NULL DEFAULT false,
    difficulty SMALLINT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
console.log("Created questions table");

// Update rounds table — add question_id, make category_id nullable
await db.execute(sql`
  ALTER TABLE rounds ADD COLUMN IF NOT EXISTS question_id INTEGER REFERENCES questions(id)
`);
await db.execute(sql`
  ALTER TABLE rounds ADD COLUMN IF NOT EXISTS correct_item_ids JSONB NOT NULL DEFAULT '[]'
`);
// Make category_id nullable for new rounds
await db.execute(sql`
  ALTER TABLE rounds ALTER COLUMN category_id DROP NOT NULL
`);
console.log("Updated rounds table");

console.log("\nSchema migration complete!");
process.exit(0);
