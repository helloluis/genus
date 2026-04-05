import { eq, and, sql } from "drizzle-orm";
import { db, poolItems, questions } from "@genus/db";
import { MODEL } from "./dashscope.js";

interface TagCheckResult {
  label: string;
  shouldHaveTag: boolean;
  valid: boolean;
  reason: string;
}

interface TagCheckResponse {
  results: TagCheckResult[];
}

async function callLLM(system: string, user: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      }
    );

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseJSON<T>(raw: string): T {
  // Strip markdown fences and think blocks
  let cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Find the JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");
  return JSON.parse(jsonMatch[0]);
}

/**
 * Check a single question: verify that items with the correctTag truly belong,
 * and a sample of items without it truly don't.
 */
export async function checkQuestion(questionId: number): Promise<{
  correct: number;
  mistagged: number;
  fixes: { itemId: number; label: string; action: "add" | "remove"; reason: string }[];
}> {
  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, questionId));

  if (!question) throw new Error(`Question ${questionId} not found`);

  // Get all items in this pool
  const allItems = await db
    .select()
    .from(poolItems)
    .where(eq(poolItems.pool, question.pool));

  // Split by tag
  const tagged: typeof allItems = [];
  const untagged: typeof allItems = [];
  for (const item of allItems) {
    const tags: string[] = Array.isArray(item.tags)
      ? item.tags
      : typeof item.tags === "string"
        ? JSON.parse(item.tags as string)
        : [];
    if (tags.includes(question.correctTag)) {
      tagged.push(item);
    } else {
      untagged.push(item);
    }
  }

  // Sample up to 20 untagged items to check for false negatives
  const shuffled = [...untagged].sort(() => Math.random() - 0.5);
  const untaggedSample = shuffled.slice(0, 20);

  const itemsToCheck = [
    ...tagged.map((i) => ({ id: i.id, label: i.label, hasTag: true })),
    ...untaggedSample.map((i) => ({ id: i.id, label: i.label, hasTag: false })),
  ];

  if (itemsToCheck.length === 0) {
    console.log(`  Question "${question.text}": no items in pool "${question.pool}"`);
    return { correct: 0, mistagged: 0, fixes: [] };
  }

  const systemPrompt = `You are a fact-checking expert for a trivia game. Your job is to verify whether items are correctly tagged for a given category/question.

The game uses a tag-based system: items in a pool have tags, and questions select correct answers by matching a specific tag. You need to verify:
1. Items WITH the tag truly belong to the category (no false positives)
2. Items WITHOUT the tag truly don't belong (no false negatives — items that SHOULD be tagged but aren't)

Be precise and factual. When in doubt, err on the side of flagging for review.

Respond ONLY with valid JSON, no markdown fences.`;

  const userPrompt = `Pool: "${question.pool}"
Question displayed to player: "${question.text}"
Tag being checked: "${question.correctTag}"

For each item below, verify whether it should or should not have the tag "${question.correctTag}".

Items currently TAGGED (supposedly correct answers):
${tagged.map((i, idx) => `${idx + 1}. "${i.label}"`).join("\n")}

Items currently NOT tagged (supposedly wrong answers — check for any that SHOULD be tagged):
${untaggedSample.map((i, idx) => `${tagged.length + idx + 1}. "${i.label}"`).join("\n")}

Return JSON:
{
  "results": [
    {"label": "item name", "shouldHaveTag": true, "valid": true, "reason": "Correct: this item belongs"},
    {"label": "item name", "shouldHaveTag": false, "valid": true, "reason": "Correct: this item does not belong"},
    {"label": "item name", "shouldHaveTag": true, "valid": false, "reason": "WRONG: tagged but doesn't actually belong because X"},
    {"label": "item name", "shouldHaveTag": false, "valid": false, "reason": "MISSING: should be tagged because X"}
  ]
}

Set "valid" to true if the current tag status is accurate. Set to false if it needs to be changed.
"shouldHaveTag" is what YOU think the correct state should be.`;

  console.log(`  Checking "${question.text}" (tag: ${question.correctTag}, pool: ${question.pool}) — ${tagged.length} tagged, ${untaggedSample.length} sampled untagged...`);

  let raw: string;
  try {
    raw = await callLLM(systemPrompt, userPrompt);
  } catch (e) {
    console.warn(`  Skipped (LLM call failed): ${(e as Error).message}`);
    return { correct: 0, mistagged: 0, fixes: [] };
  }

  let response: TagCheckResponse;
  try {
    response = parseJSON<TagCheckResponse>(raw);
  } catch (e) {
    console.error(`  Failed to parse LLM response for question ${questionId}:`, (e as Error).message);
    console.error(`  Raw response (first 500 chars):`, raw.substring(0, 500));
    return { correct: 0, mistagged: 0, fixes: [] };
  }

  let correct = 0;
  let mistagged = 0;
  const fixes: { itemId: number; label: string; action: "add" | "remove"; reason: string }[] = [];

  for (const result of response.results) {
    const item = itemsToCheck.find(
      (i) => i.label.toLowerCase() === result.label.toLowerCase()
    );
    if (!item) continue;

    if (result.valid) {
      correct++;
    } else {
      mistagged++;
      const action = result.shouldHaveTag ? "add" : "remove";
      fixes.push({ itemId: item.id, label: item.label, action, reason: result.reason });
      console.log(
        `    ✗ "${result.label}" — ${action === "add" ? "MISSING TAG" : "WRONG TAG"}: ${result.reason}`
      );
    }
  }

  console.log(`    ${correct} correct, ${mistagged} mistagged`);
  return { correct, mistagged, fixes };
}

/**
 * Check all active questions and report/fix tag issues.
 */
export async function checkAllQuestions(applyFixes = false): Promise<void> {
  const activeQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.active, true));

  console.log(`\n=== Checking ${activeQuestions.length} active questions ===\n`);

  let totalCorrect = 0;
  let totalMistagged = 0;
  const allFixes: { itemId: number; label: string; action: "add" | "remove"; tag: string; reason: string }[] = [];

  for (const q of activeQuestions) {
    const { correct, mistagged, fixes } = await checkQuestion(q.id);
    totalCorrect += correct;
    totalMistagged += mistagged;
    for (const f of fixes) {
      allFixes.push({ ...f, tag: q.correctTag });
    }
  }

  console.log(`\n=== Check complete: ${totalCorrect} correct, ${totalMistagged} mistagged ===`);

  if (allFixes.length > 0) {
    console.log(`\n${allFixes.length} fixes needed:`);
    for (const fix of allFixes) {
      console.log(`  ${fix.action === "add" ? "+" : "-"} "${fix.label}" tag:"${fix.tag}" — ${fix.reason}`);
    }

    if (applyFixes) {
      console.log(`\nApplying ${allFixes.length} fixes...`);
      for (const fix of allFixes) {
        const [item] = await db
          .select()
          .from(poolItems)
          .where(eq(poolItems.id, fix.itemId));
        if (!item) continue;

        const tags: string[] = Array.isArray(item.tags)
          ? item.tags
          : typeof item.tags === "string"
            ? JSON.parse(item.tags as string)
            : [];

        let newTags: string[];
        if (fix.action === "add") {
          newTags = [...tags, fix.tag];
        } else {
          newTags = tags.filter((t) => t !== fix.tag);
        }

        await db
          .update(poolItems)
          .set({ tags: newTags })
          .where(eq(poolItems.id, fix.itemId));
        console.log(`  Fixed: "${fix.label}" — ${fix.action} tag "${fix.tag}"`);
      }
      console.log("All fixes applied.");
    } else {
      console.log(`\nRun with --fix to apply these changes.`);
    }
  } else {
    console.log("No fixes needed!");
  }
}

// Legacy export for index.ts compatibility
export const checkAllUnverified = () => checkAllQuestions(false);
