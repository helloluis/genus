import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });
import { getDashscope, MODEL } from "./dashscope.js";
import {
  categoryGenerationPrompt,
  selectionGenerationPrompt,
  selectionVerificationPrompt,
} from "./prompts.js";

async function callLLM(
  system: string,
  user: string,
  temperature = 0.8
): Promise<string> {
  const response = await getDashscope().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: 8192,
    // @ts-ignore — Dashscope-specific extension
    enable_thinking: false,
  });
  return response.choices[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  return JSON.parse(cleaned);
}

interface GeneratedCategory {
  name: string;
  slug: string;
  difficulty: number;
  isCurrentEvents: boolean;
  description: string;
}

interface GeneratedSelection {
  label: string;
  imagePrompt: string;
}

interface SelectionGenResult {
  correct: GeneratedSelection[];
  distractors: GeneratedSelection[];
}

interface VerificationResult {
  label: string;
  markedCorrect: boolean;
  actuallyCorrect: boolean;
  valid: boolean;
  reason: string;
}

async function main() {
  const count = parseInt(process.argv[2] || "5", 10);

  // ── Step 1: Generate categories ──────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`MAKER: Generating ${count} categories...`);
  console.log(`${"=".repeat(60)}\n`);

  const catPrompt = categoryGenerationPrompt(count, []);
  const catRaw = await callLLM(catPrompt.system, catPrompt.user);
  const categories = parseJSON<GeneratedCategory[]>(catRaw);

  for (const cat of categories) {
    console.log(
      `  [${cat.difficulty === 1 ? "EASY" : cat.difficulty === 2 ? "MED " : "HARD"}] ${cat.name} (${cat.slug})${cat.isCurrentEvents ? " [CURRENT]" : ""}`
    );
    console.log(`        ${cat.description}`);
  }

  // ── Step 2: Generate selections for each category ────────
  for (const cat of categories) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`MAKER: Generating selections for "${cat.name}"...`);
    console.log(`${"─".repeat(60)}\n`);

    const selPrompt = selectionGenerationPrompt(
      cat.name,
      cat.description,
      18,
      10
    );
    const selRaw = await callLLM(selPrompt.system, selPrompt.user);
    const selections = parseJSON<SelectionGenResult>(selRaw);

    console.log(`  CORRECT (${selections.correct.length}):`);
    for (const item of selections.correct) {
      console.log(`    ✓ ${item.label} — [img: ${item.imagePrompt}]`);
    }
    console.log(`\n  DISTRACTORS (${selections.distractors.length}):`);
    for (const item of selections.distractors) {
      console.log(`    ✗ ${item.label} — [img: ${item.imagePrompt}]`);
    }

    // ── Step 3: Checker verifies this category ─────────────
    console.log(`\n  CHECKER: Verifying "${cat.name}"...\n`);

    const allItems = [
      ...selections.correct.map((s) => ({ label: s.label, isCorrect: true })),
      ...selections.distractors.map((s) => ({
        label: s.label,
        isCorrect: false,
      })),
    ];

    const checkPrompt = selectionVerificationPrompt(
      cat.name,
      cat.description,
      allItems
    );
    const checkRaw = await callLLM(checkPrompt.system, checkPrompt.user, 0.1);
    const checkResult = parseJSON<{ results: VerificationResult[] }>(checkRaw);

    let passed = 0;
    let failed = 0;
    for (const r of checkResult.results) {
      if (r.valid) {
        passed++;
      } else {
        failed++;
        console.log(`    ⚠ REJECTED: "${r.label}" — ${r.reason}`);
      }
    }
    console.log(`    Result: ${passed} passed, ${failed} rejected`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("DONE");
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
