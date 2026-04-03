import {
  pgTable,
  serial,
  text,
  boolean,
  smallint,
  integer,
  timestamp,
  uuid,
  numeric,
  date,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── Content tables (populated by Maker) ───────────────────

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  difficulty: smallint("difficulty").notNull().default(1),
  isCurrentEvents: boolean("is_current_events").notNull().default(false),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  verified: boolean("verified").notNull().default(false),
  active: boolean("active").notNull().default(true),
  hideLabels: boolean("hide_labels").notNull().default(false),
});

export const selections = pgTable("selections", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  label: text("label").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  imageUrl: text("image_url"),
  imageStatus: text("image_status").notNull().default("pending"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Gameplay tables ───────────────────────────────────────

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leaderboardPeriods = pgTable("leaderboard_periods", {
  id: serial("id").primaryKey(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  prizePool: numeric("prize_pool", { precision: 10, scale: 4 }),
  finalized: boolean("finalized").notNull().default(false),
});

export const gameSessions = pgTable("game_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .references(() => players.id),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  boxesCleared: integer("boxes_cleared").notNull().default(0),
  totalScore: integer("total_score").notNull().default(0),
  isFree: boolean("is_free").notNull().default(true),
  leaderboardPeriodId: integer("leaderboard_period_id").references(
    () => leaderboardPeriods.id
  ),
});

export const rounds = pgTable("rounds", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => gameSessions.id),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  roundNumber: smallint("round_number").notNull(),
  timeLimitMs: integer("time_limit_ms").notNull(),
  score: integer("score").notNull().default(0),
  picks: jsonb("picks").notNull().default([]),
  correctSelectionIds: jsonb("correct_selection_ids").notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const dailyUsage = pgTable(
  "daily_usage",
  {
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id),
    date: date("date").notNull().defaultNow(),
    freeGames: smallint("free_games").notNull().default(0),
    paidGames: smallint("paid_games").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.playerId, table.date] }),
  })
);
