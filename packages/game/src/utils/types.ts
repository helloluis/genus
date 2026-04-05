/** Client-side ball data (includes isCorrect for offline/test mode) */
export interface BallData {
  id: number;
  label: string;
  isCorrect: boolean;
  imageUrl?: string | null;
}

export interface BoxData {
  categoryName: string;
  wrongTemplate?: string;
  hideLabels?: boolean;
  roundNumber: number;
  timeLimitMs: number;
  helperMode: boolean;
  balls: BallData[];
}
