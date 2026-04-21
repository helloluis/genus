/**
 * Audits all active questions against the PLAYER_PROFILE and writes renames
 * and deactivations to the `audit_proposals` table for in-game review.
 *
 * The developer reviews these proposals during gameplay (Dev Mode prefers
 * questions with pending proposals). Accepted/rejected decisions become
 * training examples for future LLM runs.
 *
 * Usage: node --import tsx/esm src/audit-questions.ts
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

import { db, questions, auditProposals } from "@genus/db";
import { eq, and, inArray } from "drizzle-orm";
import { MODEL } from "./dashscope.js";
import { PLAYER_PROFILE } from "./player-profile.js";
import { getTrainingExamples } from "./training-examples.js";

const API_KEY = process.env.DASHSCOPE_API_KEY!;
const CHAT_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

type Verdict =
  | { action: "keep"; id: number; text: string; reason: string }
  | { action: "rename"; id: number; text: string; newText: string; reason: string }
  | { action: "deactivate"; id: number; text: string; reason: string };

async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      enable_thinking: false,
    }),
  });
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found");
  return JSON.parse(match[0]);
}

async function auditBatch(
  batch: { id: number; text: string; pool: string; correctTag: string }[],
  trainingExamples: string
): Promise<Verdict[]> {
  const system = `You audit trivia question text for a visual recognition game called Genus.

${PLAYER_PROFILE}

${trainingExamples}

For each question, decide:
- "keep" — question text is clear, simple, and matches the player profile
- "rename" — question meaning is fine but the words are too technical/obscure/wordy. Propose a simpler text.
- "deactivate" — question is fundamentally too subjective, too ambiguous, or too niche for the target player

Use STRICT standards. When in doubt between keep and rename, pick rename. Rename should almost always result in FEWER words, never more.

If past decisions above show the developer rejects a certain style of change (e.g. rejecting over-simplified replacements), respect that pattern.

Respond ONLY with a JSON array, no markdown.`;

  const user = `Audit these ${batch.length} trivia questions:

${batch.map((q) => `ID ${q.id} | text: "${q.text}" | pool: ${q.pool} | tag: ${q.correctTag}`).join("\n")}

Return JSON array with one entry per question:
[
  {"action": "keep", "id": 5, "text": "Has 6 Legs", "reason": "Clear and simple"},
  {"action": "rename", "id": 13, "text": "Too Many Legs!", "newText": "More Than 4 Legs!", "reason": "More specific, avoids subjective 'too many'"},
  {"action": "deactivate", "id": 99, "text": "Hypoallergenic!", "reason": "Word is too technical for non-native English speakers"}
]

For "rename", the newText MUST be 2-5 words, follow the VOCABULARY RULES, and preserve the original tag's meaning.`;

  const raw = await callLLM(system, user);
  return parseJSON<Verdict[]>(raw);
}

async function main() {
  const active = await db
    .select({
      id: questions.id,
      text: questions.text,
      pool: questions.pool,
      correctTag: questions.correctTag,
    })
    .from(questions)
    .where(eq(questions.active, true));

  // Skip questions that already have a pending proposal — don't spam dupes
  const existingPending = await db
    .select({ questionId: auditProposals.questionId })
    .from(auditProposals)
    .where(eq(auditProposals.status, "pending"));
  const skipSet = new Set(existingPending.map((p) => p.questionId));

  const toAudit = active.filter((q) => !skipSet.has(q.id));

  // Build training examples from past accepted/rejected proposals
  const trainingExamples = await getTrainingExamples(30);

  process.stdout.write(`\n=== Auditing ${toAudit.length} questions (${skipSet.size} skipped — pending proposal exists) ===\n`);
  if (trainingExamples) {
    process.stdout.write(`Using ${trainingExamples.split("\n").length - 1} past decisions as training signal.\n`);
  } else {
    process.stdout.write(`No past decisions yet — LLM running without training signal.\n`);
  }
  process.stdout.write(`\n`);

  const BATCH_SIZE = 25;
  const allVerdicts: Verdict[] = [];

  for (let i = 0; i < toAudit.length; i += BATCH_SIZE) {
    const batch = toAudit.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toAudit.length / BATCH_SIZE)} (${batch.length} items)...\n`);
    try {
      const verdicts = await auditBatch(batch, trainingExamples);
      allVerdicts.push(...verdicts);
    } catch (e) {
      process.stdout.write(`  ERROR: ${(e as Error).message}\n`);
    }
  }

  const renames = allVerdicts.filter((v) => v.action === "rename") as Extract<Verdict, { action: "rename" }>[];
  const deactivations = allVerdicts.filter((v) => v.action === "deactivate") as Extract<Verdict, { action: "deactivate" }>[];
  const keeps = allVerdicts.filter((v) => v.action === "keep");

  process.stdout.write(`\n=== SUMMARY ===\n`);
  process.stdout.write(`Keep:       ${keeps.length}\n`);
  process.stdout.write(`Rename:     ${renames.length}\n`);
  process.stdout.write(`Deactivate: ${deactivations.length}\n\n`);

  // Write proposals to DB
  let written = 0;
  for (const v of renames) {
    await db.insert(auditProposals).values({
      questionId: v.id,
      proposedAction: "rename",
      proposedValue: v.newText,
      reasoning: v.reason,
      status: "pending",
    });
    process.stdout.write(`  + rename [${v.id}] "${v.text}" → "${v.newText}"\n`);
    written++;
  }
  for (const v of deactivations) {
    await db.insert(auditProposals).values({
      questionId: v.id,
      proposedAction: "deactivate",
      proposedValue: null,
      reasoning: v.reason,
      status: "pending",
    });
    process.stdout.write(`  + deactivate [${v.id}] "${v.text}"\n`);
    written++;
  }

  process.stdout.write(`\nWrote ${written} pending proposals. Review them in Dev Mode.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
