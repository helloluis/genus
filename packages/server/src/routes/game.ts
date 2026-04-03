import type { FastifyPluginAsync } from "fastify";
import { eq, and, notInArray, sql } from "drizzle-orm";
import {
  db,
  categories,
  selections,
  gameSessions,
  rounds,
  dailyUsage,
  players,
} from "@genus/db";
import {
  StartGameSchema,
  SubmitPicksSchema,
  FIRST_BOX_TIME_MS,
  NEXT_BOX_TIME_MS,
  HELPER_MODE_ROUNDS,
  MIN_CORRECT_PER_BOX,
  MAX_CORRECT_PER_BOX,
  BALLS_PER_BOX,
  FREE_GAMES_PER_DAY,
} from "@genus/shared";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function assembleBox(
  sessionId: string,
  roundNumber: number
) {
  // Find categories already used in this session
  const usedRounds = await db
    .select({ categoryId: rounds.categoryId })
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId));
  const usedCategoryIds = usedRounds.map((r) => r.categoryId);

  // Pick a random verified category not yet used
  const availableCategories = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.verified, true),
        eq(categories.active, true),
        usedCategoryIds.length > 0
          ? notInArray(categories.id, usedCategoryIds)
          : undefined
      )
    );

  if (availableCategories.length === 0) {
    return null; // No more categories available
  }

  const category =
    availableCategories[randomInt(0, availableCategories.length - 1)];

  // Get correct and incorrect selections
  const correctSelections = await db
    .select()
    .from(selections)
    .where(
      and(
        eq(selections.categoryId, category.id),
        eq(selections.isCorrect, true),
        eq(selections.verified, true)
      )
    );

  const distractorSelections = await db
    .select()
    .from(selections)
    .where(
      and(
        eq(selections.categoryId, category.id),
        eq(selections.isCorrect, false),
        eq(selections.verified, true)
      )
    );

  // Pick random correct items (3-5)
  const numCorrect = randomInt(MIN_CORRECT_PER_BOX, MAX_CORRECT_PER_BOX);
  const pickedCorrect = shuffle(correctSelections).slice(0, numCorrect);

  // Pad with distractors to reach total (20-25)
  const totalBalls = BALLS_PER_BOX;
  const numDistractors = totalBalls - pickedCorrect.length;
  const pickedDistractors = shuffle(distractorSelections).slice(
    0,
    numDistractors
  );

  const allBalls = shuffle([...pickedCorrect, ...pickedDistractors]);
  const correctIds = pickedCorrect.map((s) => s.id);

  const timeLimitMs =
    roundNumber === 1 ? FIRST_BOX_TIME_MS : NEXT_BOX_TIME_MS;

  return {
    categoryId: category.id,
    categoryName: category.name,
    hideLabels: category.hideLabels,
    roundNumber,
    timeLimitMs,
    helperMode: roundNumber <= HELPER_MODE_ROUNDS,
    balls: allBalls.map((s) => ({
      id: s.id,
      label: s.label,
      imageUrl: s.imageUrl,
    })),
    correctIds,
  };
}

export const gameRoutes: FastifyPluginAsync = async (app) => {
  // Check if player can play (free games remaining)
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

  // Start a new game session
  app.post("/start", async (request) => {
    const body = StartGameSchema.parse(request.body);

    // Get or create player
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.deviceId, body.deviceId));

    if (!player) {
      return { error: "Player not found. Register first." };
    }

    // Create session
    const [session] = await db
      .insert(gameSessions)
      .values({ playerId: player.id })
      .returning();

    // Assemble first box
    const box = await assembleBox(session.id, 1);
    if (!box) {
      return { error: "No categories available." };
    }

    // Record the round
    await db.insert(rounds).values({
      sessionId: session.id,
      categoryId: box.categoryId,
      roundNumber: 1,
      timeLimitMs: box.timeLimitMs,
      correctSelectionIds: box.correctIds,
      startedAt: new Date(),
    });

    return {
      sessionId: session.id,
      box: {
        categoryName: box.categoryName,
        hideLabels: box.hideLabels,
        roundNumber: box.roundNumber,
        timeLimitMs: box.timeLimitMs,
        helperMode: box.helperMode,
        balls: box.balls,
        correctIds: box.correctIds,
      },
    };
  });

  // Submit picks for current round
  app.post("/submit", async (request) => {
    const body = SubmitPicksSchema.parse(request.body);

    // Get the round
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

    const correctIds = round.correctSelectionIds as number[];

    // Calculate score
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

    // Update round
    await db
      .update(rounds)
      .set({
        score: roundScore,
        picks,
        endedAt: new Date(),
      })
      .where(eq(rounds.id, round.id));

    // Update session score
    const [session] = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, body.sessionId));

    const newTotalScore = (session?.totalScore ?? 0) + roundScore;
    const newBoxesCleared = (session?.boxesCleared ?? 0) + (allCorrectSelected ? 1 : 0);

    await db
      .update(gameSessions)
      .set({
        totalScore: newTotalScore,
        boxesCleared: newBoxesCleared,
      })
      .where(eq(gameSessions.id, body.sessionId));

    // If all correct, prepare next box
    let nextBox = null;
    if (allCorrectSelected) {
      const nextRoundNumber = body.roundNumber + 1;
      const assembled = await assembleBox(body.sessionId, nextRoundNumber);

      if (assembled) {
        await db.insert(rounds).values({
          sessionId: body.sessionId,
          categoryId: assembled.categoryId,
          roundNumber: nextRoundNumber,
          timeLimitMs: assembled.timeLimitMs,
          correctSelectionIds: assembled.correctIds,
          startedAt: new Date(),
        });

        nextBox = {
          categoryName: assembled.categoryName,
          hideLabels: assembled.hideLabels,
          roundNumber: assembled.roundNumber,
          timeLimitMs: assembled.timeLimitMs,
          helperMode: assembled.helperMode,
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
