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
