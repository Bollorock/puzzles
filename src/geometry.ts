// Pure puzzle geometry: grid sizing, edge shapes and piece outlines.
// Board units are pixels of the (downscaled) working image.

export type Side = 'flat' | 'in' | 'out';

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  cols: number;
  rows: number;
  width: number;
  height: number;
  pieceW: number;
  pieceH: number;
  /** Extra margin around a piece's rectangle that fits its pegs. */
  pad: number;
}

export interface PieceShape {
  id: number;
  col: number;
  row: number;
  /** top, right, bottom, left */
  sides: [Side, Side, Side, Side];
  isEdge: boolean;
  /** Outline segments in piece-local coordinates (rectangle origin at 0,0). */
  outline: Segment[];
}

export type Segment =
  | { kind: 'line'; to: Point }
  | { kind: 'bezier'; c1: Point; c2: Point; to: Point };

export const PIECE_COUNTS = [12, 24, 48, 96, 150, 300, 500] as const;

/** Picks a grid with roughly `target` pieces that are as square as possible. */
export function gridFor(target: number, aspect: number): { cols: number; rows: number } {
  let best = { cols: 2, rows: 2, score: Infinity };
  for (let cols = 2; cols <= 60; cols++) {
    for (let rows = 2; rows <= 60; rows++) {
      const pieceAspect = aspect / (cols / rows);
      const countErr = Math.abs(cols * rows - target) / target;
      const shapeErr = Math.abs(Math.log(pieceAspect));
      const score = countErr * 2 + shapeErr * 0.6;
      if (score < best.score) best = { cols, rows, score };
    }
  }
  return { cols: best.cols, rows: best.rows };
}

export function makeLayout(width: number, height: number, cols: number, rows: number): Layout {
  const pieceW = width / cols;
  const pieceH = height / rows;
  return { cols, rows, width, height, pieceW, pieceH, pad: Math.min(pieceW, pieceH) * 0.42 };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Edge {
  /** Ten control points in board coordinates, in canonical direction. */
  pts: Point[];
  /** +1: peg protrudes towards +x / +y (into the right / lower piece). */
  dir: 1 | -1;
}

/**
 * Builds one tab edge from `a` to `b`. Based on the classic Bezier jigsaw
 * construction: a neck, a round head and slight random jitter.
 */
function tabEdge(a: Point, b: Point, depth: number, dir: 1 | -1, rnd: () => number): Edge {
  const t = 0.1;
  const j = 0.05;
  const r = () => (rnd() * 2 - 1) * j;
  const ja = r() * 0.5;
  const jb = r();
  const jc = r();
  const jd = r();
  const je = r() * 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Canonical edges run left→right or top→bottom, so (uy, ux) points to +y / +x.
  const nx = uy;
  const ny = ux;
  const P = (l: number, w: number): Point => ({
    x: a.x + ux * l * len + nx * w * depth * dir,
    y: a.y + uy * l * len + ny * w * depth * dir,
  });
  const pts = [
    P(0, 0),
    P(0.2, ja),
    P(0.5 + jb + jd, -t + jc),
    P(0.5 - t + jb, t + jc),
    P(0.5 - 2 * t + jb - jd, 3 * t + jc),
    P(0.5 + 2 * t + jb - jd, 3 * t + jc),
    P(0.5 + t + jb, t + jc),
    P(0.5 + jb + jd, -t + jc),
    P(0.8, je),
    P(1, 0),
  ];
  return { pts, dir };
}

function pushEdge(out: Segment[], edge: Edge | null, to: Point, reverse: boolean, o: Point) {
  const local = (p: Point): Point => ({ x: p.x - o.x, y: p.y - o.y });
  if (!edge) {
    out.push({ kind: 'line', to: local(to) });
    return;
  }
  const p = reverse ? [...edge.pts].reverse() : edge.pts;
  for (let i = 1; i < p.length; i += 3) {
    out.push({ kind: 'bezier', c1: local(p[i]), c2: local(p[i + 1]), to: local(p[i + 2]) });
  }
}

/** Generates the shapes of all pieces; deterministic for a given seed. */
export function generatePieces(layout: Layout, seed: number): PieceShape[] {
  const { cols, rows, pieceW: w, pieceH: h } = layout;
  const rnd = mulberry32(seed);
  const depth = Math.min(w, h);
  const flip = (): 1 | -1 => (rnd() < 0.5 ? 1 : -1);

  // horiz[r][c]: edge on line y = r*h between (c, r-1) and (c, r), r in 1..rows-1
  const horiz: (Edge | null)[][] = [];
  for (let r = 0; r <= rows; r++) {
    horiz.push([]);
    for (let c = 0; c < cols; c++) {
      horiz[r].push(
        r === 0 || r === rows
          ? null
          : tabEdge({ x: c * w, y: r * h }, { x: (c + 1) * w, y: r * h }, depth, flip(), rnd),
      );
    }
  }
  // vert[r][c]: edge on line x = c*w between (c-1, r) and (c, r)
  const vert: (Edge | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    vert.push([]);
    for (let c = 0; c <= cols; c++) {
      vert[r].push(
        c === 0 || c === cols
          ? null
          : tabEdge({ x: c * w, y: r * h }, { x: c * w, y: (r + 1) * h }, depth, flip(), rnd),
      );
    }
  }

  const pieces: PieceShape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = horiz[r][c];
      const bottom = horiz[r + 1][c];
      const left = vert[r][c];
      const right = vert[r][c + 1];
      const sides: [Side, Side, Side, Side] = [
        top ? (top.dir === 1 ? 'in' : 'out') : 'flat',
        right ? (right.dir === 1 ? 'out' : 'in') : 'flat',
        bottom ? (bottom.dir === 1 ? 'out' : 'in') : 'flat',
        left ? (left.dir === 1 ? 'in' : 'out') : 'flat',
      ];
      const o = { x: c * w, y: r * h };
      const tl = o;
      const tr = { x: o.x + w, y: o.y };
      const br = { x: o.x + w, y: o.y + h };
      const bl = { x: o.x, y: o.y + h };
      const outline: Segment[] = [];
      pushEdge(outline, top, tr, false, o);
      pushEdge(outline, right, br, false, o);
      pushEdge(outline, bottom, bl, true, o);
      pushEdge(outline, left, tl, true, o);
      pieces.push({
        id: r * cols + c,
        col: c,
        row: r,
        sides,
        isEdge: sides.includes('flat'),
        outline,
      });
    }
  }
  return pieces;
}
