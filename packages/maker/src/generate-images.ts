import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, selections } from "@genus/db";
import { eq, sql } from "drizzle-orm";
import { getDashscope, MODEL } from "./dashscope.js";
import { imageGenerationPrompt } from "./prompts.js";

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

// Concurrency: Dashscope allows a few parallel requests
const CONCURRENCY = 3;

interface DashscopeResponse {
  output?: {
    choices?: {
      message?: {
        content?: { image?: string }[];
      };
    }[];
  };
  code?: string;
  message?: string;
}

interface ImagePromptItem {
  label: string;
  imagePrompt: string;
  isPerson: boolean;
}

/** Ask the LLM to generate image prompts for a batch of labels */
async function generateImagePrompts(labels: string[]): Promise<ImagePromptItem[]> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You generate image prompts for a trivia game. Each item will become a small illustrated portrait. For each label, provide:
- imagePrompt: A description with distinctive visual features (colors, shapes, textures, props, clothing)
- isPerson: true if it's a real or fictional human character

For ANIMALS: describe their most distinctive physical features (color, pattern, shape, size context)
For DOG BREEDS: describe coat, face shape, ears, size, coloring
For LANDMARKS: describe the architecture, materials, setting, distinctive features
For COMPANY LOGOS: describe the actual logo design (shape, colors, letters, icons)
For PEOPLE: describe signature visual traits (hair, clothing, accessories)

Respond ONLY with valid JSON array, no markdown fences.`,
      },
      {
        role: "user",
        content: `Generate image prompts for these ${labels.length} items:\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nReturn JSON array:\n[{"label": "Golden Retriever", "imagePrompt": "Golden Retriever dog, flowing golden-blonde fur, friendly warm eyes, floppy ears, happy panting expression", "isPerson": false}]`,
      },
    ],
    temperature: 0.3,
    max_tokens: 16384,
    // @ts-ignore
    enable_thinking: false,
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

/** Generate a single image via Dashscope */
async function generateImage(prompt: string): Promise<string | null> {
  const body = {
    model: "qwen-image-2.0",
    input: {
      messages: [{ role: "user", content: [{ text: prompt }] }],
    },
    parameters: {
      size: "1024*1024",
      n: 1,
      prompt_extend: false,
      watermark: false,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as DashscopeResponse;
  if (data.code) {
    console.log(`    ERROR: ${data.code} — ${data.message}`);
    return null;
  }

  return data.output?.choices?.[0]?.message?.content?.[0]?.image ?? null;
}

/** Process items with concurrency limit */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log("\n=== Generating Images for Selections ===\n");

  // Get all distinct labels that need images (pending or failed)
  const retry = process.argv.includes("--retry");
  const pending = await db
    .selectDistinct({ label: selections.label })
    .from(selections)
    .where(
      retry
        ? sql`${selections.imageStatus} IN ('pending', 'failed')`
        : eq(selections.imageStatus, "pending")
    );

  console.log(`Found ${pending.length} unique labels needing images\n`);

  if (pending.length === 0) {
    console.log("Nothing to do!");
    process.exit(0);
  }

  // Generate image prompts in batches of 30
  const BATCH_SIZE = 30;
  const allPrompts: ImagePromptItem[] = [];

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const labels = batch.map((p) => p.label);
    console.log(`Generating prompts for batch ${Math.floor(i / BATCH_SIZE) + 1} (${labels.length} items)...`);

    const prompts = await generateImagePrompts(labels);
    allPrompts.push(...prompts);
  }

  console.log(`\nGenerated ${allPrompts.length} image prompts`);
  console.log(`Starting image generation (concurrency: ${CONCURRENCY})...\n`);

  // Build a map from label → image prompt
  const promptMap = new Map<string, ImagePromptItem>();
  for (const p of allPrompts) {
    promptMap.set(p.label, p);
  }

  let success = 0;
  let failed = 0;

  // Generate images with concurrency
  await processWithConcurrency(pending, CONCURRENCY, async (item) => {
    const promptItem = promptMap.get(item.label);
    if (!promptItem) {
      console.log(`  [SKIP] ${item.label} — no prompt generated`);
      failed++;
      return;
    }

    const fullPrompt = imageGenerationPrompt(promptItem.imagePrompt, promptItem.isPerson);
    console.log(`  [GEN] ${item.label}...`);

    const imageUrl = await generateImage(fullPrompt);

    if (imageUrl) {
      // Update ALL selections with this label
      await db
        .update(selections)
        .set({ imageUrl, imageStatus: "success" })
        .where(eq(selections.label, item.label));
      console.log(`    ✓ ${item.label}`);
      success++;
    } else {
      await db
        .update(selections)
        .set({ imageStatus: "failed" })
        .where(eq(selections.label, item.label));
      console.log(`    ✗ ${item.label}`);
      failed++;
    }
  });

  console.log(`\n=== Done! ${success} succeeded, ${failed} failed ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
