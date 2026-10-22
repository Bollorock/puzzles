import { describe, expect, it } from 'vite-plus/test';
import { Game } from './game';
import { generatePieces, gridFor, makeLayout, PIECE_COUNTS } from './geometry';

describe('gridFor', () => {
  it('gets close to the requested count with squarish pieces', () => {
    for (const n of PIECE_COUNTS) {
      for (const aspect of [1, 1.5, 0.75, 16 / 9]) {
        const { cols, rows } = gridFor(n, aspect);
        expect(Math.abs(cols * rows - n) / n).toBeLessThan(0.2);
        const pieceAspect = aspect / (cols / rows);
        expect(pieceAspect).toBeGreaterThan(0.7);
        expect(pieceAspect).toBeLessThan(1.4);
      }
    }
  });
});

describe('generatePieces', () => {
  const layout = makeLayout(1200, 800, 6, 4);
  const pieces = generatePieces(layout, 42);
  const at = (c: number, r: number) => pieces[r * layout.cols + c];
  const opposite = { in: 'out', out: 'in', flat: 'flat' } as const;

  it('makes flat sides exactly on the border', () => {
    for (const p of pieces) {
      expect(p.sides[0] === 'flat').toBe(p.row === 0);
      expect(p.sides[2] === 'flat').toBe(p.row === layout.rows - 1);
      expect(p.sides[3] === 'flat').toBe(p.col === 0);
      expect(p.sides[1] === 'flat').toBe(p.col === layout.cols - 1);
      expect(p.isEdge).toBe(p.sides.includes('flat'));
    }
  });

  it('gives neighbours complementary pegs', () => {
    for (const p of pieces) {
      if (p.col < layout.cols - 1) expect(at(p.col + 1, p.row).sides[3]).toBe(opposite[p.sides[1]]);
      if (p.row < layout.rows - 1) expect(at(p.col, p.row + 1).sides[0]).toBe(opposite[p.sides[2]]);
    }
  });

  it('is deterministic per seed and closes each outline', () => {
    expect(generatePieces(layout, 42)).toEqual(pieces);
    for (const p of pieces) {
      const last = p.outline[p.outline.length - 1].to;
      expect(last.x).toBeCloseTo(0);
      expect(last.y).toBeCloseTo(0);
    }
  });

  it('keeps pegs inside the padding', () => {
    for (const p of pieces) {
      for (const s of p.outline) {
        const pts = s.kind === 'line' ? [s.to] : [s.c1, s.c2, s.to];
        for (const q of pts) {
          expect(q.x).toBeGreaterThanOrEqual(-layout.pad);
          expect(q.x).toBeLessThanOrEqual(layout.pieceW + layout.pad);
          expect(q.y).toBeGreaterThanOrEqual(-layout.pad);
          expect(q.y).toBeLessThanOrEqual(layout.pieceH + layout.pad);
        }
      }
    }
  });
});

describe('Game', () => {
  const make = () => new Game(7, 400, 300, 4, 3);

  it('starts with every piece in the tray in a shuffled order', () => {
    const g = make();
    expect(g.trayPieces('all')).toHaveLength(12);
    expect(g.trayOrder).not.toEqual([...Array(12).keys()]);
    expect([...g.trayOrder].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
    expect(g.trayPieces('edge')).toHaveLength(10);
    expect(g.trayPieces('inner')).toHaveLength(2);
  });

  it('snaps matching neighbours and ignores non-neighbours', () => {
    const g = make();
    const a = g.placeFromTray(0, 500, 500);
    // Piece 1 is right of piece 0; place it slightly off its true spot.
    const b = g.placeFromTray(1, 500 + 100 + 8, 500 - 5);
    expect(g.snap(b.id, 20)).toEqual({ gid: a.id, snapped: true });
    expect(g.groups.size).toBe(1);
    expect(g.piecePos(1)).toEqual({ x: 600, y: 500 });

    // Piece 10 is not adjacent to 0 or 1.
    const c = g.placeFromTray(10, 500 + 200, 500 + 200);
    expect(g.snap(c.id, 1000).snapped).toBe(false);
  });

  it('does not snap pieces that are too far away', () => {
    const g = make();
    g.placeFromTray(0, 0, 0);
    const b = g.placeFromTray(1, 300, 0);
    expect(g.snap(b.id, 20).snapped).toBe(false);
  });

  it('chains merges across groups', () => {
    const g = make();
    g.placeFromTray(0, 0, 0);
    g.placeFromTray(2, 200, 0);
    const mid = g.placeFromTray(1, 101, 1);
    g.snap(mid.id, 10);
    expect(g.groups.size).toBe(1);
  });

  it('gathers only single pieces back to the tray', () => {
    const g = make();
    g.placeFromTray(0, 0, 0);
    const b = g.placeFromTray(1, 100, 0);
    g.snap(b.id, 5);
    g.placeFromTray(11, 900, 900);
    g.placeFromTray(5, -900, 900);
    expect(g.gatherSingles()).toBe(2);
    expect(g.groups.size).toBe(1);
    expect(g.trayPieces('all')).toHaveLength(10);
  });

  it('locks corner pieces into the frame', () => {
    const g = make();
    // Piece 3 is the top-right corner; its true spot is (300, 0).
    const corner = g.placeFromTray(3, 300 + 6, -4);
    expect(g.snap(corner.id, 10)).toEqual({ gid: corner.id, snapped: true });
    expect(g.piecePos(3)).toEqual({ x: 300, y: 0 });
    expect(corner.locked).toBe(true);
    g.moveGroup(corner.id, 50, 50);
    expect(g.piecePos(3)).toEqual({ x: 300, y: 0 });
    expect(g.returnToTray(corner.id)).toBe(false);
    expect(g.gatherSingles()).toBe(0);

    // A non-corner piece near its spot does not lock on its own.
    const edge = g.placeFromTray(1, 100 + 3, 2);
    expect(g.snap(edge.id, 10).snapped).toBe(false);
    expect(edge.locked).toBe(false);

    // Joining a locked group locks the result without moving the frame.
    const next = g.placeFromTray(2, 200 + 4, 3);
    const { gid } = g.snap(next.id, 10);
    expect(g.groups.get(gid)!.locked).toBe(true);
    expect(g.piecePos(3)).toEqual({ x: 300, y: 0 });
    expect(g.piecePos(1)).toEqual({ x: 100, y: 0 });
    expect(g.zOrder[0]).toBe(gid);
  });

  it('does not lock a corner far from its spot', () => {
    const g = make();
    const corner = g.placeFromTray(0, 40, 40);
    expect(g.snap(corner.id, 10).snapped).toBe(false);
    expect(corner.locked).toBe(false);
  });

  it('detects completion and round-trips saves', () => {
    const g = make();
    for (const pid of g.trayOrder) {
      const p = g.pieces[pid];
      const grp = g.placeFromTray(pid, p.col * 100, p.row * 100);
      g.snap(grp.id, 5);
    }
    expect(g.isComplete).toBe(true);

    const h = make();
    h.placeFromTray(3, 10, 20);
    const save = h.toSave({ credit: '', filter: 'edge', elapsedMs: 5 });
    const restored = Game.fromSave(JSON.parse(JSON.stringify(save)));
    expect(restored.trayOrder).toEqual(h.trayOrder);
    expect(restored.piecePos(3)).toEqual({ x: 10, y: 20 });
    expect(restored.trayPieces('all')).toHaveLength(11);

    const k = make();
    const c = k.placeFromTray(0, 2, 2);
    k.snap(c.id, 5);
    const back = Game.fromSave(
      JSON.parse(JSON.stringify(k.toSave({ credit: '', filter: 'all', elapsedMs: 0 }))),
    );
    expect(back.groups.get(c.id)!.locked).toBe(true);
  });
});
