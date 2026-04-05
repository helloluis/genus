import type { FastifyPluginAsync } from "fastify";
import { db, devFeedback } from "@genus/db";

interface DevFeedbackBody {
  questionText: string;
  correctTag?: string;
  pool?: string;
  options: { id: number; label: string; isCorrect: boolean }[];
  selectedOptionId?: number;
  selectedOptionLabel?: string;
  feedback: string;
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
};
