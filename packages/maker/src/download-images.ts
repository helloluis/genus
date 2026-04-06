/**
 * Download all pool item images to local files and update URLs to self-hosted paths.
 * Run on VPS: node --import tsx/esm src/download-images.ts
 *
 * Since Dashscope URLs have expired, this script regenerates images
 * and immediately downloads them to /opt/genus/packages/game/dist/images/
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, poolItems } from "@genus/db";
import { eq, sql } from "drizzle-orm";
import { getDashscope, MODEL } from "./dashscope.js";
import { imageGenerationPrompt } from "./prompts.js";

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const IMAGE_ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

// Where to save images — served by Fastify static
const IMAGE_DIR = resolve(__dirname, "../../game/dist/images");
const IMAGE_URL_PREFIX = "/images"; // relative URL for the game client

const CONCURRENCY = 2;
const BATCH_SIZE = 20;

async function generateImagePrompts(
  items: { label: string; pool: string; tags: string[] }[]
): Promise<Map<string, { prompt: string; isPerson: boolean }>> {
  const labels = items.map(
    (i) => `${i.label} (pool: ${i.pool}, tags: ${(i.tags as string[]).slice(0, 5).join(", ")})`
  );

  const res = await fetch(
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You generate image prompts for a trivia game. Each item becomes a small illustrated portrait.
For each item, return a detailed visual description including franchise/source context.
- PEOPLE/CHARACTERS: signature visual traits, costume, hair, props. Include franchise name.
- ANIMALS: distinctive physical features, colors, patterns, habitat context.
- DOG BREEDS: coat type, face shape, ears, size, coloring.
- LANDMARKS: architecture, materials, setting, distinctive features.
- LOGOS: actual logo design (shape, colors, letters, icons).

Respond ONLY with valid JSON array, no markdown fences.`,
          },
          {
            role: "user",
            content: `Generate image prompts for these ${labels.length} items:\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nReturn JSON array:\n[{"label": "...", "imagePrompt": "detailed visual description with franchise context", "isPerson": false}]`,
          },
        ],
        temperature: 0.3,
        max_tokens: 16384,
        enable_thinking: false,
      }),
    }
  );

  const data = (await res.json()) as any;
  const raw = data.choices?.[0]?.message?.content ?? "[]";
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  const parsed = JSON.parse(cleaned) as {
    label: string;
    imagePrompt: string;
    isPerson: boolean;
  }[];

  const map = new Map<string, { prompt: string; isPerson: boolean }>();
  for (const p of parsed) {
    map.set(p.label, { prompt: p.imagePrompt, isPerson: p.isPerson });
  }
  return map;
}

async function generateAndDownloadImage(
  prompt: string,
  filename: string
): Promise<string | null> {
  const body = {
    model: "qwen-image-2.0",
    input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
    parameters: {
      size: "1024*1024",
      n: 1,
      prompt_extend: false,
      watermark: false,
    },
  };

  const res = await fetch(IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as any;
  if (data.code) {
    process.stdout.write(`    ERROR: ${data.code} — ${data.message}\n`);
    return null;
  }

  const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;
  if (!imageUrl) return null;

  // Download immediately before URL expires
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return null;

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const filePath = resolve(IMAGE_DIR, filename);
  await writeFile(filePath, buffer);

  return `${IMAGE_URL_PREFIX}/${filename}`;
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
}

async function main() {
  // Create image directory
  await mkdir(IMAGE_DIR, { recursive: true });
  process.stdout.write(`Image dir: ${IMAGE_DIR}\n`);

  // Get all items
  const allItems = await db
    .select({
      id: poolItems.id,
      label: poolItems.label,
      pool: poolItems.pool,
      tags: poolItems.tags,
      imageUrl: poolItems.imageUrl,
      imageStatus: poolItems.imageStatus,
    })
    .from(poolItems);

  // Filter: only items that need regeneration (expired URLs or no image)
  const needsImage = allItems.filter((item) => {
    // Already has a self-hosted URL
    if (item.imageUrl?.startsWith(IMAGE_URL_PREFIX)) return false;
    return true;
  });

  process.stdout.write(
    `\n=== Regenerating ${needsImage.length} images (${allItems.length} total) ===\n\n`
  );

  let success = 0;
  let failed = 0;

  // Process in batches to get image prompts
  for (let b = 0; b < needsImage.length; b += BATCH_SIZE) {
    const batch = needsImage.slice(b, b + BATCH_SIZE);
    process.stdout.write(
      `Batch ${Math.floor(b / BATCH_SIZE) + 1}/${Math.ceil(needsImage.length / BATCH_SIZE)} — generating prompts for ${batch.length} items...\n`
    );

    const promptMap = await generateImagePrompts(
      batch.map((i) => ({
        label: i.label,
        pool: i.pool,
        tags: Array.isArray(i.tags) ? i.tags : [],
      }))
    );

    await processWithConcurrency(batch, CONCURRENCY, async (item) => {
      const promptInfo = promptMap.get(item.label);
      if (!promptInfo) {
        process.stdout.write(`  [SKIP] ${item.label} — no prompt\n`);
        failed++;
        return;
      }

      const fullPrompt = imageGenerationPrompt(
        promptInfo.prompt,
        promptInfo.isPerson
      );
      const filename = `${item.pool}_${item.id}.png`;

      process.stdout.write(`  [GEN] ${item.label}...`);

      const localUrl = await generateAndDownloadImage(fullPrompt, filename);
      if (localUrl) {
        await db
          .update(poolItems)
          .set({ imageUrl: localUrl, imageStatus: "success" })
          .where(eq(poolItems.id, item.id));
        process.stdout.write(` ✓\n`);
        success++;
      } else {
        await db
          .update(poolItems)
          .set({ imageStatus: "failed" })
          .where(eq(poolItems.id, item.id));
        process.stdout.write(` ✗\n`);
        failed++;
      }
    });
  }

  process.stdout.write(
    `\n=== Done: ${success} succeeded, ${failed} failed ===\n`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
