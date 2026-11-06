// User preferences in localStorage. Storage may be unavailable (private
// mode), in which case defaults are used and changes just aren't kept.

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-memory value still applies for this visit.
  }
}

export interface Settings {
  sound: boolean;
  vibration: boolean;
  panZoom: boolean;
}

export const settings: Settings = {
  sound: lsGet('sound') !== 'off',
  vibration: lsGet('vibration') !== 'off',
  panZoom: lsGet('panZoom') !== 'off',
};

export function setSetting(key: keyof Settings, on: boolean) {
  settings[key] = on;
  lsSet(key, on ? 'on' : 'off');
}

/** Where a dragged piece is shown relative to the finger, so the finger doesn't cover it. */
export type OffsetDir = 'off' | 'upLeft' | 'up' | 'upRight';
export type OffsetDist = 'near' | 'far';

const OFFSET_DIRS: OffsetDir[] = ['off', 'upLeft', 'up', 'upRight'];
const OFFSET_DISTS: OffsetDist[] = ['near', 'far'];

function pick<T extends string>(value: string | null, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export const dragOffset = {
  dir: pick(lsGet('offsetDir'), OFFSET_DIRS, 'off'),
  dist: pick(lsGet('offsetDist'), OFFSET_DISTS, 'near'),
};

export function setDragOffset(dir: OffsetDir, dist: OffsetDist) {
  dragOffset.dir = dir;
  dragOffset.dist = dist;
  lsSet('offsetDir', dir);
  lsSet('offsetDist', dist);
}

/** The offset in screen pixels, or null when it is turned off. */
export function offsetVector(dir: OffsetDir, dist: OffsetDist): { x: number; y: number } | null {
  if (dir === 'off') return null;
  const len = dist === 'far' ? 110 : 60;
  if (dir === 'up') return { x: 0, y: -len };
  const d = len * Math.SQRT1_2;
  return { x: dir === 'upLeft' ? -d : d, y: -d };
}

/** Piece counts offered on the home screen. Users can add their own and remove any. */
export const DEFAULT_PIECE_COUNTS = [12, 24, 48, 96, 150, 300, 500, 750, 1000];
export const MIN_PIECES = 4;
export const MAX_PIECES = 2000;

/** Reads a stored list, keeping only valid counts, sorted and without duplicates. */
export function parsePieceCounts(raw: string | null): number[] {
  if (raw === null) return [...DEFAULT_PIECE_COUNTS];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [...DEFAULT_PIECE_COUNTS];
  }
  if (!Array.isArray(list)) return [...DEFAULT_PIECE_COUNTS];
  const valid = list.filter(
    (n): n is number => Number.isInteger(n) && n >= MIN_PIECES && n <= MAX_PIECES,
  );
  const counts = [...new Set(valid)].sort((a, b) => a - b);
  return counts.length ? counts : [...DEFAULT_PIECE_COUNTS];
}

/** Why `n` can't be added, or null when it can. */
export function pieceCountError(n: number, counts: readonly number[]): string | null {
  if (!Number.isInteger(n)) return 'Enter a whole number';
  if (n < MIN_PIECES || n > MAX_PIECES) return `Choose ${MIN_PIECES} to ${MAX_PIECES} pieces`;
  if (counts.includes(n)) return `${n} is already in the list`;
  return null;
}

export let pieceCounts = parsePieceCounts(lsGet('pieceCounts'));

function savePieceCounts(counts: number[]) {
  pieceCounts = counts;
  lsSet('pieceCounts', JSON.stringify(counts));
}

export function addPieceCount(n: number) {
  savePieceCounts([...pieceCounts, n].sort((a, b) => a - b));
}

/** Removes `n`, keeping at least one count. Returns false if it was the last one. */
export function removePieceCount(n: number): boolean {
  if (pieceCounts.length <= 1) return false;
  savePieceCounts(pieceCounts.filter((c) => c !== n));
  return true;
}

export function resetPieceCounts() {
  savePieceCounts([...DEFAULT_PIECE_COUNTS]);
}

/** The count in `counts` closest to `n`; used when the chosen count is removed. */
export function nearestCount(n: number, counts: readonly number[]): number {
  return counts.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best));
}
