import { z } from "zod";

// ── Category ──────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  slug: string;
  difficulty: number;
  isCurrentEvents: boolean;
  verified: boolean;
  active: boolean;
  generatedAt: Date;
}

// ── Selection ─────────────────────────────────────────────

export type ImageStatus = "pending" | "generating" | "verified" | "rejected";

export interface Selection {
  id: number;
  categoryId: number;
  label: string;
  isCorrect: boolean;
  imageUrl: string | null;
  imageStatus: ImageStatus;
  verified: boolean;
  createdAt: Date;
}

// ── Game ──────────────────────────────────────────────────

export interface BallData {
  id: number;
  label: string;
  imageUrl: string | null;
}

export interface BoxData {
  categoryName: string;
  roundNumber: number;
  timeLimitMs: number;
  helperMode: boolean;
  balls: BallData[];
}

export interface PickResult {
  selectionId: number;
  correct: boolean;
}

export interface RoundResult {
  score: number;
  picks: PickResult[];
  correctIds: number[];
  gameOver: boolean;
  nextBox: BoxData | null;
}

// ── Session ───────────────────────────────────────────────

export interface GameSession {
  id: string;
  playerId: string;
  startedAt: Date;
  endedAt: Date | null;
  boxesCleared: number;
  totalScore: number;
  isFree: boolean;
}

// ── Leaderboard ───────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  totalScore: number;
  boxesCleared: number;
}

// ── API Schemas (Zod) ─────────────────────────────────────

export const StartGameSchema = z.object({
  deviceId: z.string().min(1),
});

export const SubmitPicksSchema = z.object({
  sessionId: z.string().uuid(),
  roundNumber: z.number().int().positive(),
  selectedBallIds: z.array(z.number().int()),
});

export const RegisterPlayerSchema = z.object({
  deviceId: z.string().min(1),
});
