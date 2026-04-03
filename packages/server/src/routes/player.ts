import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db, players } from "@genus/db";
import { RegisterPlayerSchema } from "@genus/shared";

export const playerRoutes: FastifyPluginAsync = async (app) => {
  // Register or get player by device ID
  app.post("/player", async (request, reply) => {
    const body = RegisterPlayerSchema.parse(request.body);

    // Check if player already exists
    const [existing] = await db
      .select()
      .from(players)
      .where(eq(players.deviceId, body.deviceId));

    if (existing) {
      return { playerId: existing.id };
    }

    const [player] = await db
      .insert(players)
      .values({ deviceId: body.deviceId })
      .returning();

    return { playerId: player.id };
  });
};
