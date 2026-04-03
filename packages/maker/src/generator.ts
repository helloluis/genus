import { eq } from "drizzle-orm";
import { db, categories, selections } from "@genus/db";
import { getDashscope, MODEL } from "./dashscope.js";
import {
  categoryGenerationPrompt,
  selectionGenerationPrompt,
} from "./prompts.js";

interface GeneratedCategory {
  name: string;
  slug: string;
  difficulty: number;
  isCurrentEvents: boolean;
  description: string;
}

interface GeneratedSelection {
  label: string;
  description: string;
}

interface SelectionGenResult {
  correct: GeneratedSelection[];
  distractors: GeneratedSelection[];
}

async function callLLM(system: string, user: string): Promise<string> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
  });
  return response.choices[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

export async function generateCategories(count: number): Promise<number[]> {
  // Get existing slugs to avoid duplicates
  const existing = await db
    .select({ slug: categories.slug })
    .from(categories);
  const existingSlugs = existing.map((c) => c.slug);

  const prompt = categoryGenerationPrompt(count, existingSlugs);
  const raw = await callLLM(prompt.system, prompt.user);
  const generated = parseJSON<GeneratedCategory[]>(raw);

  const insertedIds: number[] = [];

  for (const cat of generated) {
    // Skip if slug already exists
    if (existingSlugs.includes(cat.slug)) {
      console.log(`Skipping duplicate category: ${cat.slug}`);
      continue;
    }

    const [inserted] = await db
      .insert(categories)
      .values({
        name: cat.name,
        slug: cat.slug,
        difficulty: cat.difficulty,
        isCurrentEvents: cat.isCurrentEvents,
      })
      .returning();

    insertedIds.push(inserted.id);
    console.log(`Created category: ${cat.name} (id: ${inserted.id})`);
  }

  return insertedIds;
}

export async function generateSelectionsForCategory(
  categoryId: number,
  targetCorrect = 18,
  targetDistractors = 10
): Promise<void> {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!category) {
    throw new Error(`Category ${categoryId} not found`);
  }

  console.log(`Generating selections for: ${category.name}...`);

  const prompt = selectionGenerationPrompt(
    category.name,
    category.name, // description fallback
    targetCorrect,
    targetDistractors
  );
  const raw = await callLLM(prompt.system, prompt.user);
  const result = parseJSON<SelectionGenResult>(raw);

  const values = [
    ...result.correct.map((item) => ({
      categoryId,
      label: item.label,
      isCorrect: true,
    })),
    ...result.distractors.map((item) => ({
      categoryId,
      label: item.label,
      isCorrect: false,
    })),
  ];

  await db.insert(selections).values(values);

  console.log(
    `  Inserted ${result.correct.length} correct + ${result.distractors.length} distractors`
  );
}

export async function generateAll(categoryCount: number): Promise<void> {
  console.log(`\n=== Generating ${categoryCount} categories ===\n`);
  const ids = await generateCategories(categoryCount);

  console.log(`\n=== Generating selections for ${ids.length} categories ===\n`);
  for (const id of ids) {
    await generateSelectionsForCategory(id);
  }

  console.log("\n=== Generation complete ===\n");
}
