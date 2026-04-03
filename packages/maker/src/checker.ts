import { eq, and } from "drizzle-orm";
import { db, categories, selections } from "@genus/db";
import { getDashscope, MODEL } from "./dashscope.js";
import { selectionVerificationPrompt } from "./prompts.js";

interface VerificationResult {
  label: string;
  markedCorrect: boolean;
  actuallyCorrect: boolean;
  valid: boolean;
  reason: string;
}

interface VerificationResponse {
  results: VerificationResult[];
}

async function callLLM(system: string, user: string): Promise<string> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1, // Low temperature for fact-checking
  });
  return response.choices[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

export async function checkCategory(categoryId: number): Promise<{
  verified: number;
  rejected: number;
}> {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!category) {
    throw new Error(`Category ${categoryId} not found`);
  }

  // Get all unverified selections for this category
  const unverified = await db
    .select()
    .from(selections)
    .where(
      and(
        eq(selections.categoryId, categoryId),
        eq(selections.verified, false)
      )
    );

  if (unverified.length === 0) {
    console.log(`Category "${category.name}": no unverified selections.`);
    return { verified: 0, rejected: 0 };
  }

  console.log(
    `Checking ${unverified.length} selections for "${category.name}"...`
  );

  const items = unverified.map((s) => ({
    label: s.label,
    isCorrect: s.isCorrect,
  }));

  const prompt = selectionVerificationPrompt(
    category.name,
    category.name,
    items
  );
  const raw = await callLLM(prompt.system, prompt.user);
  const response = parseJSON<VerificationResponse>(raw);

  let verified = 0;
  let rejected = 0;

  for (const result of response.results) {
    const selection = unverified.find(
      (s) => s.label.toLowerCase() === result.label.toLowerCase()
    );
    if (!selection) continue;

    if (result.valid) {
      await db
        .update(selections)
        .set({ verified: true })
        .where(eq(selections.id, selection.id));
      verified++;
    } else {
      // Delete invalid selections
      await db.delete(selections).where(eq(selections.id, selection.id));
      rejected++;
      console.log(
        `  Rejected: "${result.label}" — ${result.reason}`
      );
    }
  }

  // Check if category meets minimum thresholds
  const verifiedCorrect = await db
    .select()
    .from(selections)
    .where(
      and(
        eq(selections.categoryId, categoryId),
        eq(selections.verified, true),
        eq(selections.isCorrect, true)
      )
    );

  const verifiedDistractors = await db
    .select()
    .from(selections)
    .where(
      and(
        eq(selections.categoryId, categoryId),
        eq(selections.verified, true),
        eq(selections.isCorrect, false)
      )
    );

  const meetsThreshold =
    verifiedCorrect.length >= 15 && verifiedDistractors.length >= 8;

  if (meetsThreshold) {
    await db
      .update(categories)
      .set({ verified: true })
      .where(eq(categories.id, categoryId));
    console.log(
      `  ✓ Category "${category.name}" verified (${verifiedCorrect.length} correct, ${verifiedDistractors.length} distractors)`
    );
  } else {
    console.log(
      `  ✗ Category "${category.name}" needs more items (${verifiedCorrect.length}/15 correct, ${verifiedDistractors.length}/8 distractors)`
    );
  }

  return { verified, rejected };
}

export async function checkAllUnverified(): Promise<void> {
  const unverifiedCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.verified, false));

  console.log(
    `\n=== Checking ${unverifiedCategories.length} unverified categories ===\n`
  );

  let totalVerified = 0;
  let totalRejected = 0;

  for (const cat of unverifiedCategories) {
    const { verified, rejected } = await checkCategory(cat.id);
    totalVerified += verified;
    totalRejected += rejected;
  }

  console.log(
    `\n=== Check complete: ${totalVerified} verified, ${totalRejected} rejected ===\n`
  );
}
