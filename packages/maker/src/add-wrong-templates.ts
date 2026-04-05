import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db } from "@genus/db";
import { sql } from "drizzle-orm";
import { getDashscope, MODEL } from "./dashscope.js";

// Add column
await db.execute(sql`ALTER TABLE questions ADD COLUMN IF NOT EXISTS wrong_template TEXT NOT NULL DEFAULT ''`);
console.log("Added wrong_template column");

// Get all questions
const rows = await db.execute(sql`SELECT id, text, pool, correct_tag FROM questions ORDER BY id`);
const questions = rows as any[];

console.log(`\nGenerating wrong templates for ${questions.length} questions...`);

// Batch through LLM
const BATCH = 40;
for (let i = 0; i < questions.length; i += BATCH) {
  const batch = questions.slice(i, i + BATCH);
  const items = batch.map((q: any, idx: number) =>
    `${idx + 1}. Question: "${q.text}" (pool: ${q.pool}, tag: ${q.correct_tag})`
  ).join("\n");

  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You write error messages for a trivia game. When a player picks the wrong answer, we show a message explaining why it's wrong. The message uses {name} as a placeholder for the wrong item's label.

Rules:
- Keep it short, punchy, and fun
- Use natural grammar that makes sense for the question
- Examples:
  - Question "Action Star" → "{name} isn't an action star!"
  - Question "Found in Europe" → "{name} isn't in Europe!"
  - Question "Has 6 Legs" → "{name} doesn't have 6 legs!"
  - Question "Meat Eater!" → "{name} doesn't eat meat!"
  - Question "Golden Retriever" → "That's not a Golden Retriever!"
  - Question "Venomous!" → "{name} isn't venomous!"
  - Question "Big Dogs" → "{name} isn't a big dog!"
  - Question "The Bad Guys" → "{name} isn't a villain!"
  - Question "Made in Japan" → "{name} isn't from Japan!"

Respond ONLY with valid JSON array, no markdown fences.`
      },
      {
        role: "user",
        content: `Generate wrong_template for each question. Use {name} as the placeholder.\n\n${items}\n\nReturn JSON array:\n[{"id": 1, "wrong_template": "{name} isn't an action star!"}]`
      }
    ],
    temperature: 0.3,
    max_tokens: 8192,
    // @ts-ignore
    enable_thinking: false,
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  const templates = JSON.parse(cleaned) as { id: number; wrong_template: string }[];

  for (const t of templates) {
    const q = batch[templates.indexOf(t)];
    if (q) {
      await db.execute(sql`UPDATE questions SET wrong_template = ${t.wrong_template} WHERE id = ${q.id}`);
    }
  }

  console.log(`  Batch ${Math.floor(i / BATCH) + 1}: ${templates.length} templates`);
}

// Show samples
const samples = await db.execute(sql`SELECT text, wrong_template FROM questions ORDER BY random() LIMIT 10`);
console.log("\nSamples:");
for (const s of samples as any) console.log(`  "${s.text}" → ${s.wrong_template}`);

process.exit(0);
