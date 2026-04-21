import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db, devFeedback, auditProposals, questions } from "@genus/db";

interface DevFeedbackBody {
  questionText: string;
  correctTag?: string;
  pool?: string;
  options: { id: number; label: string; isCorrect: boolean }[];
  selectedOptionId?: number;
  selectedOptionLabel?: string;
  feedback: string;
}

interface ProposalDecisionBody {
  proposalId: number;
  decision: "accepted" | "rejected";
  userReason?: string;
}

export const devRoutes: FastifyPluginAsync = async (app) => {
  app.post("/feedback", async (request) => {
    const body = request.body as DevFeedbackBody;

    const [row] = await db
      .insert(devFeedback)
      .values({
        questionText: body.questionText,
        correctTag: body.correctTag ?? null,
        pool: body.pool ?? null,
        options: body.options,
        selectedOptionId: body.selectedOptionId ?? null,
        selectedOptionLabel: body.selectedOptionLabel ?? null,
        feedback: body.feedback,
      })
      .returning();

    return { id: row.id, saved: true };
  });

  app.post("/proposal", async (request) => {
    const body = request.body as ProposalDecisionBody;

    // Fetch the proposal
    const [proposal] = await db
      .select()
      .from(auditProposals)
      .where(eq(auditProposals.id, body.proposalId));

    if (!proposal) return { error: "Proposal not found" };
    if (proposal.status !== "pending") {
      return { error: `Proposal already ${proposal.status}` };
    }

    // If accepted, apply the change
    if (body.decision === "accepted" && proposal.questionId != null) {
      if (proposal.proposedAction === "rename" && proposal.proposedValue) {
        await db
          .update(questions)
          .set({ text: proposal.proposedValue })
          .where(eq(questions.id, proposal.questionId));
      } else if (proposal.proposedAction === "deactivate") {
        await db
          .update(questions)
          .set({ active: false })
          .where(eq(questions.id, proposal.questionId));
      }
    }

    // Mark proposal reviewed
    await db
      .update(auditProposals)
      .set({
        status: body.decision,
        userReason: body.userReason ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(auditProposals.id, body.proposalId));

    return { saved: true, decision: body.decision };
  });
};
