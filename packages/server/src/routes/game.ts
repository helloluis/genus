import type { FastifyPluginAsync } from "fastify";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  db,
  poolItems,
  questions,
  gameSessions,
  rounds,
  dailyUsage,
  players,
  auditProposals,
} from "@genus/db";
import {
  StartGameSchema,
  SubmitPicksSchema,
  FIRST_BOX_TIME_MS,
  NEXT_BOX_TIME_MS,
  BALLS_PER_BOX,
  FREE_GAMES_PER_DAY,
} from "@genus/shared";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function assembleBox(sessionId: string, roundNumber: number, devMode = false) {
  // Find question IDs already used in this session
  const usedRounds = await db
    .select({ questionId: rounds.questionId })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId));
  const usedQuestionIds = usedRounds
    .map((r) => r.questionId)
    .filter((id): id is number => id != null);

  // Pick a random active question not yet used
  const available = await db
    .select()
    .from(questions)
    .where(eq(questions.active, true));

  const unused = available.filter((q) => !usedQuestionIds.includes(q.id));
  if (unused.length === 0) return null;

  // In dev mode, prefer questions that have pending proposals
  let question = unused[Math.floor(Math.random() * unused.length)];
  let proposal: { id: number; action: string; value: string | null; reasoning: string } | null = null;

  if (devMode) {
    const pending = await db
      .select()
      .from(auditProposals)
      .where(eq(auditProposals.status, "pending"));

    const pendingByQuestion = new Map<number, typeof pending[number]>();
    for (const p of pending) {
      if (p.questionId != null) pendingByQuestion.set(p.questionId, p);
    }

    const withProposal = unused.filter((q) => pendingByQuestion.has(q.id));
    if (withProposal.length > 0) {
      question = withProposal[Math.floor(Math.random() * withProposal.length)];
      const p = pendingByQuestion.get(question.id)!;
      proposal = {
        id: p.id,
        action: p.proposedAction,
        value: p.proposedValue,
        reasoning: p.reasoning,
      };
    }
  }

  // Get all items from this pool with images
  const allItems = await db
    .select()
    .from(poolItems)
    .where(
      and(
        eq(poolItems.pool, question.pool),
        eq(poolItems.imageStatus, "success")
      )
    );

  // Split into correct (has the tag) and distractors (doesn't)
  const correct: typeof allItems = [];
  const distractors: typeof allItems = [];
  for (const item of allItems) {
    const tags: string[] = Array.isArray(item.tags) ? item.tags : typeof item.tags === "string" ? JSON.parse(item.tags as string) : [];
    if (tags.includes(question.correctTag)) {
      correct.push(item);
    } else {
      distractors.push(item);
    }
  }

  if (correct.length === 0 || distractors.length < BALLS_PER_BOX - 1) {
    // Not enough items — skip this question
    return null;
  }

  // Pick 1 correct + fill rest with distractors
  const pickedCorrect = shuffle(correct).slice(0, 1);
  const pickedDistractors = shuffle(distractors).slice(0, BALLS_PER_BOX - 1);
  const allBalls = shuffle([...pickedCorrect, ...pickedDistractors]);
  const correctIds = pickedCorrect.map((s) => s.id);

  const timeLimitMs = roundNumber === 1 ? FIRST_BOX_TIME_MS : NEXT_BOX_TIME_MS;

  return {
    questionId: question.id,
    questionText: question.text,
    wrongTemplate: question.wrongTemplate,
    hideLabels: question.hideLabels,
    roundNumber,
    timeLimitMs,
    balls: allBalls.map((s) => ({
      id: s.id,
      label: s.label,
      imageUrl: s.imageUrl,
    })),
    correctIds,
    proposal,
  };
}

export const gameRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { playerId: string } }>(
    "/can-play",
    async (request) => {
      const { playerId } = request.query;
      const today = new Date().toISOString().split("T")[0];

      const [usage] = await db
        .select()
        .from(dailyUsage)
        .where(
          and(
            eq(dailyUsage.playerId, playerId),
            eq(dailyUsage.date, today)
          )
        );

      const freeGamesUsed = usage?.freeGames ?? 0;
      return {
        canPlay: true,
        freeGamesRemaining: Math.max(0, FREE_GAMES_PER_DAY - freeGamesUsed),
        requiresPayment: freeGamesUsed >= FREE_GAMES_PER_DAY,
      };
    }
  );

  app.post("/start", async (request) => {
    const body = StartGameSchema.parse(request.body);
    const devMode = (request.body as any)?.devMode === true;

    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.deviceId, body.deviceId));

    if (!player) {
      return { error: "Player not found. Register first." };
    }

    const [session] = await db
      .insert(gameSessions)
      .values({ playerId: player.id })
      .returning();

    const box = await assembleBox(session.id, 1, devMode);
    if (!box) {
      return { error: "No questions available." };
    }

    await db.insert(rounds).values({
      sessionId: session.id,
      questionId: box.questionId,
      roundNumber: 1,
      timeLimitMs: box.timeLimitMs,
      correctItemIds: box.correctIds,
      startedAt: new Date(),
    });

    return {
      sessionId: session.id,
      devMode,
      box: {
        categoryName: box.questionText,
        wrongTemplate: box.wrongTemplate,
        hideLabels: box.hideLabels,
        roundNumber: box.roundNumber,
        timeLimitMs: box.timeLimitMs,
        balls: box.balls,
        correctIds: box.correctIds,
        proposal: box.proposal,
      },
    };
  });

  // Request next box for an active session
  app.post("/next-box", async (request) => {
    const { sessionId, roundNumber, devMode } = request.body as {
      sessionId: string;
      roundNumber: number;
      devMode?: boolean;
    };

    const box = await assembleBox(sessionId, roundNumber, devMode === true);
    if (!box) {
      return { box: null };
    }

    await db.insert(rounds).values({
      sessionId,
      questionId: box.questionId,
      roundNumber,
      timeLimitMs: box.timeLimitMs,
      correctItemIds: box.correctIds,
      startedAt: new Date(),
    });

    return {
      box: {
        categoryName: box.questionText,
        wrongTemplate: box.wrongTemplate,
        hideLabels: box.hideLabels,
        roundNumber: box.roundNumber,
        timeLimitMs: box.timeLimitMs,
        balls: box.balls,
        correctIds: box.correctIds,
        proposal: box.proposal,
      },
    };
  });

  app.post("/submit", async (request) => {
    const body = SubmitPicksSchema.parse(request.body);

    const [round] = await db
      .select()
      .from(rounds)
      .where(
        and(
          eq(rounds.sessionId, body.sessionId),
          eq(rounds.roundNumber, body.roundNumber)
        )
      );

    if (!round) {
      return { error: "Round not found." };
    }

    const correctIds = round.correctItemIds as number[];

    let roundScore = 0;
    const picks = body.selectedBallIds.map((id) => {
      const correct = correctIds.includes(id);
      if (correct) roundScore += 1;
      else roundScore -= 1;
      return { selectionId: id, correct };
    });

    const allCorrectSelected = correctIds.every((id) =>
      body.selectedBallIds.includes(id)
    );

    await db
      .update(rounds)
      .set({ score: roundScore, picks, endedAt: new Date() })
      .where(eq(rounds.id, round.id));

    const [session] = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, body.sessionId));

    await db
      .update(gameSessions)
      .set({
        totalScore: (session?.totalScore ?? 0) + roundScore,
        boxesCleared: (session?.boxesCleared ?? 0) + (allCorrectSelected ? 1 : 0),
      })
      .where(eq(gameSessions.id, body.sessionId));

    let nextBox = null;
    if (allCorrectSelected) {
      const nextRoundNumber = body.roundNumber + 1;
      const assembled = await assembleBox(body.sessionId, nextRoundNumber);

      if (assembled) {
        await db.insert(rounds).values({
          sessionId: body.sessionId,
          questionId: assembled.questionId,
          roundNumber: nextRoundNumber,
          timeLimitMs: assembled.timeLimitMs,
          correctItemIds: assembled.correctIds,
          startedAt: new Date(),
        });

        nextBox = {
          categoryName: assembled.questionText,
          hideLabels: assembled.hideLabels,
          roundNumber: assembled.roundNumber,
          timeLimitMs: assembled.timeLimitMs,
          balls: assembled.balls,
          correctIds: assembled.correctIds,
        };
      }
    }

    return {
      score: roundScore,
      picks,
      correctIds,
      gameOver: !allCorrectSelected || !nextBox,
      nextBox,
    };
  });
};
