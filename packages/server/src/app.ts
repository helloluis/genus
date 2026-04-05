import Fastify from "fastify";
import cors from "@fastify/cors";
import { gameRoutes } from "./routes/game.js";
import { playerRoutes } from "./routes/player.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { devRoutes } from "./routes/dev.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Routes
  await app.register(playerRoutes, { prefix: "/api" });
  await app.register(gameRoutes, { prefix: "/api/game" });
  await app.register(leaderboardRoutes, { prefix: "/api" });
  await app.register(devRoutes, { prefix: "/api/dev" });

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
