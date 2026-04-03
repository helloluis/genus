import type { FastifyPluginAsync } from "fastify";
import { and, gte, lte, desc, eq } from "drizzle-orm";
import { db, gameSessions, leaderboardPeriods } from "@genus/db";

export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  // Get current leaderboard
  app.get("/leaderboard", async () => {
    const now = new Date();

    // Find current period
    const [period] = await db
      .select()
      .from(leaderboardPeriods)
      .where(
        and(
          lte(leaderboardPeriods.startsAt, now),
          gte(leaderboardPeriods.endsAt, now)
        )
      );

    if (!period) {
      return { period: null, entries: [] };
    }

    // Get top 50 sessions in this period
    const topSessions = await db
      .select({
        playerId: gameSessions.playerId,
        totalScore: gameSessions.totalScore,
        boxesCleared: gameSessions.boxesCleared,
      })
      .from(gameSessions)
      .where(eq(gameSessions.leaderboardPeriodId, period.id))
      .orderBy(desc(gameSessions.totalScore))
      .limit(50);

    const entries = topSessions.map((s, i) => ({
      rank: i + 1,
      playerId: s.playerId,
      totalScore: s.totalScore,
      boxesCleared: s.boxesCleared,
    }));

    return {
      period: {
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        prizePool: period.prizePool,
      },
      entries,
    };
  });
};
