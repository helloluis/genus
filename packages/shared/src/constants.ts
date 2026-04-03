/** Timer duration for the first box in milliseconds */
export const FIRST_BOX_TIME_MS = 15_000;

/** Timer duration for subsequent boxes in milliseconds */
export const NEXT_BOX_TIME_MS = 15_000;

/** Number of rounds with helper mode enabled */
export const HELPER_MODE_ROUNDS = 3;

/** Helper mode activates when this many milliseconds remain */
export const HELPER_ACTIVATE_MS = 3_000;

/** Points awarded for a correct pick */
export const CORRECT_PICK_SCORE = 1;

/** Points deducted for a wrong pick */
export const WRONG_PICK_SCORE = -1;

/** Balls per box (always 16 for 4x4 grid) */
export const BALLS_PER_BOX = 16;

/** Minimum correct items per box */
export const MIN_CORRECT_PER_BOX = 1;

/** Maximum correct items per box */
export const MAX_CORRECT_PER_BOX = 3;

/** Free games allowed per player per day */
export const FREE_GAMES_PER_DAY = 2;

/** Cost per paid game in USD */
export const PAID_GAME_COST_USD = 0.01;

/** Leaderboard period duration in hours */
export const LEADERBOARD_PERIOD_HOURS = 4;

/** Minimum total verified selections required per category (correct + distractors) */
export const MIN_TOTAL_SELECTIONS_PER_CATEGORY = 25;
