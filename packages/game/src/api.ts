import type { BoxData } from "./utils/types.js";

const API_BASE = "/api";

let playerId: string | null = null;
let sessionId: string | null = null;
let currentRoundNumber = 0;

/** Server box response (no isCorrect — scoring is server-side) */
interface ServerBall {
  id: number;
  label: string;
  imageUrl: string | null;
}

interface ServerBox {
  categoryName: string;
  wrongTemplate?: string;
  hideLabels: boolean;
  roundNumber: number;
  timeLimitMs: number;
  helperMode: boolean;
  balls: ServerBall[];
  correctIds: number[];
}

interface StartGameResponse {
  sessionId: string;
  box: ServerBox;
}

interface SubmitResponse {
  score: number;
  picks: { selectionId: number; correct: boolean }[];
  correctIds: number[];
  gameOver: boolean;
  nextBox: ServerBox | null;
}

function getDeviceId(): string {
  let id = localStorage.getItem("genus_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("genus_device_id", id);
  }
  return id;
}

export async function registerPlayer(): Promise<string> {
  const deviceId = getDeviceId();
  const res = await fetch(`${API_BASE}/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  const data = await res.json();
  playerId = data.playerId;
  return playerId!;
}

export async function startGame(): Promise<BoxData> {
  if (!playerId) await registerPlayer();

  const deviceId = getDeviceId();
  const res = await fetch(`${API_BASE}/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  const data: StartGameResponse = await res.json();
  sessionId = data.sessionId;
  currentRoundNumber = data.box.roundNumber;

  return serverBoxToLocal(data.box);
}

/** Fire-and-forget: sync picks with server in background */
export function syncPicks(selectedBallIds: number[]): void {
  fetch(`${API_BASE}/game/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      roundNumber: currentRoundNumber,
      selectedBallIds,
    }),
  }).catch((err) => console.warn("Sync failed:", err));
}

/** Fetch the next box from the server */
export async function fetchNextBox(): Promise<BoxData | null> {
  currentRoundNumber++;
  try {
    const res = await fetch(`${API_BASE}/game/next-box`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, roundNumber: currentRoundNumber }),
    });
    const data = await res.json();
    if (data.box) {
      return serverBoxToLocal(data.box);
    }
  } catch (err) {
    console.warn("fetchNextBox failed:", err);
  }
  return null;
}

/** Convert server box to local BoxData with isCorrect set from correctIds */
function serverBoxToLocal(box: ServerBox): BoxData {
  const correctSet = new Set(box.correctIds);
  return {
    categoryName: box.categoryName,
    wrongTemplate: box.wrongTemplate,
    hideLabels: box.hideLabels,
    roundNumber: box.roundNumber,
    timeLimitMs: box.timeLimitMs,
    helperMode: box.helperMode,
    balls: box.balls.map((b) => ({
      id: b.id,
      label: b.label,
      imageUrl: b.imageUrl,
      isCorrect: correctSet.has(b.id),
    })),
  };
}

/** Submit developer feedback about a round */
export async function submitDevFeedback(payload: {
  questionText: string;
  correctTag?: string;
  pool?: string;
  options: { id: number; label: string; isCorrect: boolean }[];
  selectedOptionId?: number;
  selectedOptionLabel?: string;
  feedback: string;
}): Promise<void> {
  try {
    await fetch(`${API_BASE}/dev/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Dev feedback submit failed:", err);
  }
}

/** Check if we're in offline/test mode (no server) */
export function isOfflineMode(): boolean {
  return false; // Set to true to use hardcoded test data
}
