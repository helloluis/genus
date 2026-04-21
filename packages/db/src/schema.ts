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

/** A pool of items sharing a visual domain (animals, dogs, landmarks, etc.) */
export const poolItems = pgTable("pool_items", {
  id: serial("id").primaryKey(),
  pool: text("pool").notNull(), // "animals", "dogs", "landmarks", "logos", "monsters", "fictional", "real-people"
  label: text("label").notNull(),
  imageUrl: text("image_url"),
  imageStatus: text("image_status").notNull().default("pending"),
  tags: jsonb("tags").notNull().default([]), // string[] — e.g. ["mammal", "large", "african", "carnivore"]
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A question that can be asked against a pool using tag filters */
export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(), // Display text, e.g. "Action Star"
  pool: text("pool").notNull(), // Which pool to query
  correctTag: text("correct_tag").notNull(), // Items with this tag are correct
  wrongTemplate: text("wrong_template").notNull().default(""), // e.g. "{name} isn't venomous!"
  hideLabels: boolean("hide_labels").notNull().default(false),
  difficulty: smallint("difficulty").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Legacy tables (kept for migration, will be removed) ───

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
  questionId: integer("question_id").references(() => questions.id),
  roundNumber: smallint("round_number").notNull(),
  timeLimitMs: integer("time_limit_ms").notNull(),
  score: integer("score").notNull().default(0),
  picks: jsonb("picks").notNull().default([]),
  correctItemIds: jsonb("correct_item_ids").notNull().default([]),
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

// ── Developer feedback ───────────────────────────────────

export const devFeedback = pgTable("dev_feedback", {
  id: serial("id").primaryKey(),
  questionText: text("question_text").notNull(),
  correctTag: text("correct_tag"),
  pool: text("pool"),
  options: jsonb("options").notNull().default([]), // { id, label, isCorrect }[]
  selectedOptionId: integer("selected_option_id"),
  selectedOptionLabel: text("selected_option_label"),
  feedback: text("feedback").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * LLM-generated change proposals reviewed by the developer during gameplay.
 * Accepted proposals feed back into future LLM prompts as training examples.
 */
export const auditProposals = pgTable("audit_proposals", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id").references(() => questions.id),
  proposedAction: text("proposed_action").notNull(), // "rename" | "deactivate"
  proposedValue: text("proposed_value"), // new question text for rename
  reasoning: text("reasoning").notNull(), // LLM's reason for the proposal
  status: text("status").notNull().default("pending"), // pending | accepted | rejected
  userReason: text("user_reason"), // developer's reason on accept/reject
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});
