/**
 * Feedback Worker — polls dev_feedback for new entries and acts on them.
 *
 * Actions it can take based on LLM interpretation of feedback:
 * - deactivate_question: Mark a question as inactive
 * - rename_question: Change a question's display text
 * - fix_tag: Add or remove a tag from a pool item
 * - rerender_image: Re-generate an image for a pool item
 * - skip: No automated action needed (e.g., general comments)
 *
 * Runs on a 5-minute poll interval. Processes each feedback entry once
 * by marking it with a processed_at timestamp.
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, devFeedback, questions, poolItems } from "@genus/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { MODEL } from "./dashscope.js";
import { imageGenerationPrompt } from "./prompts.js";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const DASHSCOPE_CHAT = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const DASHSCOPE_IMAGE = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const IMAGE_DIR = resolve("/opt/genus/packages/game/dist/images");

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── LLM helpers ──────────────────────────────────────────

async function callLLM(system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(DASHSCOPE_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseJSON<T>(raw: string): T {
  let cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found");
  return JSON.parse(match[0]);
}

// ── Action types ─────────────────────────────────────────

interface Action {
  type: "deactivate_question" | "rename_question" | "fix_tag" | "rerender_image" | "skip";
  questionText?: string;
  newName?: string;
  itemLabel?: string;
  pool?: string;
  tag?: string;
  tagAction?: "add" | "remove";
  reason: string;
}

// ── Interpret feedback ───────────────────────────────────

async function interpretFeedback(entry: typeof devFeedback.$inferSelect): Promise<Action[]> {
  const options = entry.options as { id: number; label: string; isCorrect: boolean }[];
  const optionsList = options.map((o) => `${o.label}${o.isCorrect ? " (CORRECT)" : ""}`).join(", ");

  const system = `You interpret developer feedback for a trivia game called Genus. The game shows a 4x4 grid of images and asks players to find the correct one.

Based on the feedback, return a JSON array of actions to take. Each action has a "type" and relevant fields.

Action types:
- "deactivate_question": Remove a question/category. Fields: questionText, reason
- "rename_question": Change question display text. Fields: questionText, newName, reason
- "fix_tag": Add or remove a tag. Fields: itemLabel, pool, tag, tagAction ("add"|"remove"), reason
- "rerender_image": Re-generate an image. Fields: itemLabel, pool, reason
- "skip": No automated action possible. Fields: reason

Rules:
- If feedback says "remove this category" or similar → deactivate_question
- If feedback mentions wrong/bad images → rerender_image
- If feedback says an item should/shouldn't be a correct answer → fix_tag
- If feedback suggests renaming → rename_question
- If feedback is just a comment or too vague → skip
- You can return multiple actions for one feedback entry

Respond ONLY with a JSON array, no markdown.`;

  const user = `Question: "${entry.questionText}"
Options shown: ${optionsList}
Selected: ${entry.selectedOptionLabel || "none"} (id: ${entry.selectedOptionId || "none"})
Feedback: "${entry.feedback}"

What actions should be taken?`;

  const raw = await callLLM(system, user);
  try {
    return parseJSON<Action[]>(raw);
  } catch {
    console.log(`  Could not parse actions, skipping: ${raw.substring(0, 200)}`);
    return [{ type: "skip", reason: "Failed to parse LLM response" }];
  }
}

// ── Execute actions ──────────────────────────────────────

async function executeAction(action: Action): Promise<boolean> {
  switch (action.type) {
    case "deactivate_question": {
      if (!action.questionText) return false;
      const result = await db
        .update(questions)
        .set({ active: false })
        .where(eq(questions.text, action.questionText));
      console.log(`    ✓ Deactivated question: "${action.questionText}"`);
      return true;
    }

    case "rename_question": {
      if (!action.questionText || !action.newName) return false;
      await db
        .update(questions)
        .set({ text: action.newName })
        .where(eq(questions.text, action.questionText));
      console.log(`    ✓ Renamed: "${action.questionText}" → "${action.newName}"`);
      return true;
    }

    case "fix_tag": {
      if (!action.itemLabel || !action.tag || !action.tagAction) return false;
      // Find the item — try with pool first, then without
      let [item] = action.pool
        ? await db.select().from(poolItems).where(and(eq(poolItems.label, action.itemLabel), eq(poolItems.pool, action.pool)))
        : [];
      if (!item) {
        [item] = await db.select().from(poolItems).where(eq(poolItems.label, action.itemLabel));
      }
      if (!item) {
        console.log(`    ✗ Item not found: "${action.itemLabel}"`);
        return false;
      }

      const tags: string[] = Array.isArray(item.tags) ? item.tags : [];
      let newTags: string[];
      if (action.tagAction === "add") {
        if (tags.includes(action.tag)) {
          console.log(`    - Already has tag: "${action.itemLabel}" + "${action.tag}"`);
          return true;
        }
        newTags = [...tags, action.tag];
      } else {
        newTags = tags.filter((t) => t !== action.tag);
      }

      await db.update(poolItems).set({ tags: newTags }).where(eq(poolItems.id, item.id));
      console.log(`    ✓ ${action.tagAction === "add" ? "+" : "-"} "${action.itemLabel}" tag:"${action.tag}"`);
      return true;
    }

    case "rerender_image": {
      if (!action.itemLabel) return false;
      let [item] = action.pool
        ? await db.select().from(poolItems).where(and(eq(poolItems.label, action.itemLabel), eq(poolItems.pool, action.pool)))
        : [];
      if (!item) {
        [item] = await db.select().from(poolItems).where(eq(poolItems.label, action.itemLabel));
      }
      if (!item) {
        console.log(`    ✗ Item not found: "${action.itemLabel}"`);
        return false;
      }

      const tags: string[] = Array.isArray(item.tags) ? item.tags : [];
      const isPerson = item.pool === "fictional" || tags.includes("humanoid");

      // Ask LLM for a good image prompt with context
      const promptRaw = await callLLM(
        "You generate image prompts for a trivia game. Given an item name, its pool, and tags, generate a detailed visual description. Include franchise/source context. Respond with ONLY the prompt text, nothing else.",
        `Item: "${item.label}", Pool: "${item.pool}", Tags: ${JSON.stringify(tags)}\n\nGenerate a detailed image prompt with franchise context and distinctive visual features.`
      );
      const prompt = promptRaw.trim().replace(/^["']|["']$/g, "");
      const fullPrompt = imageGenerationPrompt(prompt, isPerson);

      console.log(`    [GEN] ${item.label} — ${prompt.substring(0, 80)}...`);

      const body = {
        model: "qwen-image-2.0",
        input: { messages: [{ role: "user", content: [{ text: fullPrompt }] }] },
        parameters: { size: "1024*1024", n: 1, prompt_extend: false, watermark: false },
      };

      const res = await fetch(DASHSCOPE_IMAGE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as any;
      const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;

      if (imageUrl) {
        // Download and save locally as JPG
        try {
          await mkdir(IMAGE_DIR, { recursive: true });
          const pngFile = resolve(IMAGE_DIR, `${item.pool}_${item.id}.png`);
          const jpgFile = resolve(IMAGE_DIR, `${item.pool}_${item.id}.jpg`);
          const imgRes = await fetch(imageUrl);
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          await writeFile(pngFile, buffer);
          // Convert to JPG
          try {
            execSync(`convert "${pngFile}" -resize 512x512 -quality 80 "${jpgFile}" && rm "${pngFile}"`);
          } catch {
            // If imagemagick not available, keep as PNG
            await writeFile(jpgFile, buffer); // save as-is with .jpg extension
          }
          const localUrl = `/images/${item.pool}_${item.id}.jpg`;
          await db.update(poolItems).set({ imageUrl: localUrl, imageStatus: "success" }).where(eq(poolItems.id, item.id));
          console.log(`    ✓ Re-rendered and saved: "${item.label}"`);
        } catch (e) {
          console.log(`    ✗ Download failed: ${(e as Error).message}`);
          return false;
        }
        return true;
      } else {
        console.log(`    ✗ Image gen failed: ${data.code || "unknown"}`);
        return false;
      }
    }

    case "skip":
      console.log(`    - Skipped: ${action.reason}`);
      return true;

    default:
      return false;
  }
}

// ── Main loop ────────────────────────────────────────────

async function processNewFeedback() {
  // Get unprocessed feedback (no processed_at timestamp)
  const unprocessed = await db
    .select()
    .from(devFeedback)
    .where(sql`${devFeedback.createdAt} > NOW() - INTERVAL '24 hours'
      AND ${devFeedback.id} NOT IN (
        SELECT id FROM dev_feedback WHERE feedback LIKE '%[processed]%'
      )`);

  // Filter to truly unprocessed by checking a marker
  // We'll append [processed] to the feedback text after processing
  const pending = unprocessed.filter(
    (e) => !(e.feedback as string).includes("[processed]")
  );

  if (pending.length === 0) {
    return 0;
  }

  console.log(`\n  Processing ${pending.length} new feedback entries...`);
  let actionsExecuted = 0;

  for (const entry of pending) {
    console.log(`\n  Feedback #${entry.id}: "${(entry.feedback as string).substring(0, 80)}..."`);

    const actions = await interpretFeedback(entry);

    for (const action of actions) {
      console.log(`    Action: ${action.type} — ${action.reason}`);
      const ok = await executeAction(action);
      if (ok) actionsExecuted++;
    }

    // Mark as processed
    await db
      .update(devFeedback)
      .set({ feedback: entry.feedback + " [processed]" })
      .where(eq(devFeedback.id, entry.id));
  }

  return actionsExecuted;
}

async function main() {
  const once = process.argv.includes("--once");

  console.log(`\n=== Feedback Worker Started ===`);
  console.log(`  Mode: ${once ? "single run" : `polling every ${POLL_INTERVAL_MS / 1000}s`}`);

  const run = async () => {
    try {
      const count = await processNewFeedback();
      if (count > 0) {
        console.log(`\n  Executed ${count} actions`);
      } else {
        console.log(`  No new feedback`);
      }
    } catch (e) {
      console.error("  Worker error:", (e as Error).message);
    }
  };

  await run();

  if (!once) {
    setInterval(run, POLL_INTERVAL_MS);
    console.log(`\n  Waiting for next poll...`);
  } else {
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
