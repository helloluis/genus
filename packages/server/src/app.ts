import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { gameRoutes } from "./routes/game.js";
import { playerRoutes } from "./routes/player.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { devRoutes } from "./routes/dev.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Serve built game client in production
  const gameDistPath = resolve(__dirname, "../../game/dist");
  if (existsSync(gameDistPath)) {
    await app.register(fastifyStatic, {
      root: gameDistPath,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback — serve index.html for non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  // Routes
  await app.register(playerRoutes, { prefix: "/api" });
  await app.register(gameRoutes, { prefix: "/api/game" });
  await app.register(leaderboardRoutes, { prefix: "/api" });
  await app.register(devRoutes, { prefix: "/api/dev" });

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
