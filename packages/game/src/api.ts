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

/** Request the next box from the server (after clearing a round) */
export async function fetchNextBox(): Promise<BoxData | null> {
  try {
    const res = await fetch(`${API_BASE}/game/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        roundNumber: currentRoundNumber,
        selectedBallIds: [], // empty — server already has the picks from syncPicks
      }),
    });
    const data: SubmitResponse = await res.json();
    if (data.nextBox) {
      currentRoundNumber = data.nextBox.roundNumber;
      return serverBoxToLocal(data.nextBox);
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

/** Check if we're in offline/test mode (no server) */
export function isOfflineMode(): boolean {
  return false; // Set to true to use hardcoded test data
}
