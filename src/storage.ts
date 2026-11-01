import type { PuzzleImage } from './images';

/** Where a piece is: in the side tray, loose on the table, or placed on the board. */
export type PieceState = 'tray' | 'table' | 'placed';

export type SavedPiece = { state: PieceState; x: number; y: number };

export type SavedGame = {
  version: 2;
  image: PuzzleImage;
  cols: number;
  rows: number;
  seed: number;
  /** Indexed by row * cols + col. Positions in world units (one cell = 1). */
  pieces: SavedPiece[];
  /** Tray order, first to last. */
  tray: number[];
  /** Table draw order, bottom to top. */
  table: number[];
  guide: boolean;
};

const GAME_KEY = 'jigsaw.game';
const SOUND_KEY = 'jigsaw.sound';

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as SavedGame;
    if (g.version !== 2 || g.pieces.length !== g.cols * g.rows) return null;
    return g;
  } catch {
    return null;
  }
}

export function saveGame(g: SavedGame): void {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(g));
  } catch {
    // Storage full (large own photo). Losing the save is better than crashing.
  }
}

export function clearGame(): void {
  localStorage.removeItem(GAME_KEY);
}

export function soundOn(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setSound(on: boolean): void {
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}
