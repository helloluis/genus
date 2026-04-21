/**
 * Fetches past accepted/rejected audit proposals to inject into LLM prompts
 * as in-context training signal. The goal is to align future LLM judgements
 * with the developer's demonstrated taste.
 */

import { db, auditProposals, questions } from "@genus/db";
import { and, eq, ne, desc, sql, inArray } from "drizzle-orm";

interface TrainingExample {
  status: "accepted" | "rejected";
  proposedAction: string;
  originalText: string;
  proposedValue: string | null;
  reasoning: string;
  userReason: string | null;
}

/**
 * Returns a formatted block of past decisions for inclusion in a system prompt.
 * Returns empty string if there are no reviewed decisions yet.
 */
export async function getTrainingExamples(limit = 30): Promise<string> {
  const rows = await db
    .select({
      status: auditProposals.status,
      proposedAction: auditProposals.proposedAction,
      proposedValue: auditProposals.proposedValue,
      reasoning: auditProposals.reasoning,
      userReason: auditProposals.userReason,
      originalText: questions.text,
    })
    .from(auditProposals)
    .leftJoin(questions, eq(auditProposals.questionId, questions.id))
    .where(inArray(auditProposals.status, ["accepted", "rejected"]))
    .orderBy(desc(auditProposals.reviewedAt))
    .limit(limit);

  if (rows.length === 0) return "";

  const lines: string[] = [];
  lines.push("PAST DEVELOPER DECISIONS (use these as style/judgement guide):");
  for (const r of rows) {
    const mark = r.status === "accepted" ? "✓ ACCEPTED" : "✗ REJECTED";
    let line = "";
    if (r.proposedAction === "rename") {
      line = `${mark}: rename "${r.originalText}" → "${r.proposedValue}"`;
    } else if (r.proposedAction === "deactivate") {
      line = `${mark}: deactivate "${r.originalText}"`;
    } else {
      line = `${mark}: ${r.proposedAction} "${r.originalText}"`;
    }
    if (r.userReason) line += ` — "${r.userReason}"`;
    lines.push(`  ${line}`);
  }

  return lines.join("\n");
}
