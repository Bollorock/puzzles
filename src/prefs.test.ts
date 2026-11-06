import { describe, expect, it } from 'vite-plus/test';
import {
  addPieceCount,
  DEFAULT_PIECE_COUNTS,
  nearestCount,
  offsetVector,
  parsePieceCounts,
  pieceCountError,
  pieceCounts,
  removePieceCount,
  resetPieceCounts,
} from './prefs';

describe('offsetVector', () => {
  it('is null when turned off', () => {
    expect(offsetVector('off', 'far')).toBeNull();
  });

  it('points up, up-left or up-right, further when far', () => {
    expect(offsetVector('up', 'near')).toEqual({ x: 0, y: -60 });
    const left = offsetVector('upLeft', 'near')!;
    const right = offsetVector('upRight', 'near')!;
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeCloseTo(-left.x);
    expect(left.y).toBeLessThan(0);
    expect(Math.hypot(left.x, left.y)).toBeCloseTo(60);
    expect(Math.hypot(...Object.values(offsetVector('upRight', 'far')!))).toBeCloseTo(110);
  });
});

describe('piece counts', () => {
  it('falls back to the defaults for missing or broken data', () => {
    expect(parsePieceCounts(null)).toEqual(DEFAULT_PIECE_COUNTS);
    expect(parsePieceCounts('nope')).toEqual(DEFAULT_PIECE_COUNTS);
    expect(parsePieceCounts('{}')).toEqual(DEFAULT_PIECE_COUNTS);
    expect(parsePieceCounts('[]')).toEqual(DEFAULT_PIECE_COUNTS);
  });

  it('keeps valid counts, sorted and unique', () => {
    expect(parsePieceCounts('[200, 30, 2, 30, 1.5, "x", 99999, 64]')).toEqual([30, 64, 200]);
  });

  it('explains why a count cannot be added', () => {
    expect(pieceCountError(60, [12, 24])).toBeNull();
    expect(pieceCountError(12, [12, 24])).toMatch(/already/);
    expect(pieceCountError(2, [])).toMatch(/4 to 2000/);
    expect(pieceCountError(2001, [])).toMatch(/4 to 2000/);
    expect(pieceCountError(10.5, [])).toMatch(/whole/);
    expect(pieceCountError(NaN, [])).toMatch(/whole/);
  });

  it('adds and removes counts, keeping at least one', () => {
    resetPieceCounts();
    addPieceCount(60);
    expect(pieceCounts).toContain(60);
    expect(pieceCounts).toEqual([...pieceCounts].sort((a, b) => a - b));
    for (const n of [...pieceCounts].slice(1)) expect(removePieceCount(n)).toBe(true);
    expect(pieceCounts).toEqual([12]);
    expect(removePieceCount(12)).toBe(false);
    expect(pieceCounts).toEqual([12]);
  });

  it('finds the nearest remaining count', () => {
    expect(nearestCount(48, [12, 60, 300])).toBe(60);
    expect(nearestCount(1000, [12, 60, 300])).toBe(300);
  });
});
