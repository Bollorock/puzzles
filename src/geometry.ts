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
  /**
   * Outline segments in piece-local coordinates (rectangle origin at 0,0).
   * The outline is closed: it starts where the last segment ends.
   */
  outline: Segment[];
}

export type Segment =
  | { kind: 'line'; to: Point }
  | { kind: 'bezier'; c1: Point; c2: Point; to: Point };

export const PIECE_COUNTS = [12, 24, 48, 96, 150, 300, 500, 750, 1000] as const;

/**
 * classic: a straight grid with round knobs.
 * unusual: a wobbly grid with a mix of knob shapes (keys, dovetails, arrows, double knobs).
 */
export type ShapeStyle = 'classic' | 'unusual';

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

export function makeLayout(
  width: number,
  height: number,
  cols: number,
  rows: number,
  style: ShapeStyle = 'classic',
): Layout {
  const pieceW = width / cols;
  const pieceH = height / rows;
  // Unusual pieces need room for knobs on edges whose corners are pushed outwards.
  const pad = Math.min(pieceW, pieceH) * (style === 'unusual' ? 0.62 : 0.42);
  return { cols, rows, width, height, pieceW, pieceH, pad };
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
export function generatePieces(
  layout: Layout,
  seed: number,
  style: ShapeStyle = 'classic',
): PieceShape[] {
  if (style === 'unusual') return generateUnusual(layout, seed);
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
      const o = { x: c * w, y: r * h };
      const tl = o;
      const tr = { x: o.x + w, y: o.y };
      const br = { x: o.x + w, y: o.y + h };
      const bl = { x: o.x, y: o.y + h };
      pieces.push(assemble(r * cols + c, c, r, [top, right, bottom, left], [tl, tr, br, bl], o));
    }
  }
  return pieces;
}

/** Builds a piece from its four edges (top, right, bottom, left) and corners (tl, tr, br, bl). */
function assemble(
  id: number,
  col: number,
  row: number,
  [top, right, bottom, left]: (Edge | null)[],
  [tl, tr, br, bl]: Point[],
  o: Point,
): PieceShape {
  const sides: [Side, Side, Side, Side] = [
    top ? (top.dir === 1 ? 'in' : 'out') : 'flat',
    right ? (right.dir === 1 ? 'out' : 'in') : 'flat',
    bottom ? (bottom.dir === 1 ? 'out' : 'in') : 'flat',
    left ? (left.dir === 1 ? 'in' : 'out') : 'flat',
  ];
  const outline: Segment[] = [];
  pushEdge(outline, top, tr, false, o);
  pushEdge(outline, right, br, false, o);
  pushEdge(outline, bottom, bl, true, o);
  pushEdge(outline, left, tl, true, o);
  return { id, col, row, sides, isEdge: sides.includes('flat'), outline };
}

// ---- unusual shapes ------------------------------------------------------

/**
 * A knob as a chain of cubic Bezier points (3k + 1 of them) from (0, 0) to
 * (1, 0). x runs along the edge as a fraction of its length; y is how far the
 * knob protrudes, as a fraction of the piece size.
 */
type Chain = [number, number][];

/** Straight lines through `pts`, as a Bezier chain. */
function polyChain(pts: [number, number][]): Chain {
  const out: Chain = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    out.push(
      [ax + (bx - ax) / 3, ay + (by - ay) / 3],
      [ax + ((bx - ax) * 2) / 3, ay + ((by - ay) * 2) / 3],
      [bx, by],
    );
  }
  return out;
}

/** The classic round knob centred at `c`, `s` times the usual height. */
function roundChain(c: number, s: number, rnd: () => number): Chain {
  const t = 0.1;
  const j = () => (rnd() * 2 - 1) * 0.04;
  const jd = j();
  const jc = j();
  return [
    [0, 0],
    [c - 0.3, j() * 0.5],
    [c + jd, (-t + jc) * s],
    [c - t, (t + jc) * s],
    [c - 2 * t, (3 * t + jc) * s],
    [c + 2 * t, (3 * t + jc) * s],
    [c + t, (t + jc) * s],
    [c + jd, (-t + jc) * s],
    [c + 0.3, j() * 0.5],
    [1, 0],
  ];
}

/** Squeezes a chain into [l0, l1] along the edge. */
function squeeze(chain: Chain, l0: number, l1: number): Chain {
  return chain.map(([x, y]) => [l0 + x * (l1 - l0), y]);
}

const KNOBS: ((rnd: () => number) => Chain)[] = [
  // Round knob, off centre and of varying size.
  (rnd) => roundChain(0.42 + rnd() * 0.16, 0.85 + rnd() * 0.2, rnd),
  // Key: a narrow neck with a square head.
  (rnd) => {
    const c = 0.42 + rnd() * 0.16;
    return polyChain([
      [0, 0],
      [c - 0.065, 0],
      [c - 0.065, 0.13],
      [c - 0.16, 0.13],
      [c - 0.16, 0.31],
      [c + 0.16, 0.31],
      [c + 0.16, 0.13],
      [c + 0.065, 0.13],
      [c + 0.065, 0],
      [1, 0],
    ]);
  },
  // Dovetail.
  (rnd) => {
    const c = 0.42 + rnd() * 0.16;
    return polyChain([
      [0, 0],
      [c - 0.08, 0],
      [c - 0.17, 0.29],
      [c + 0.17, 0.29],
      [c + 0.08, 0],
      [1, 0],
    ]);
  },
  // Arrow head on a short neck.
  (rnd) => {
    const c = 0.42 + rnd() * 0.16;
    return polyChain([
      [0, 0],
      [c - 0.06, 0],
      [c - 0.06, 0.12],
      [c - 0.17, 0.12],
      [c, 0.34],
      [c + 0.17, 0.12],
      [c + 0.06, 0.12],
      [c + 0.06, 0],
      [1, 0],
    ]);
  },
  // Two small round knobs side by side.
  (rnd) => [
    [0, 0],
    [0.05 / 3, 0],
    [0.1 / 3, 0],
    ...squeeze(roundChain(0.5, 0.6, rnd), 0.05, 0.5),
    ...squeeze(roundChain(0.5, 0.6, rnd), 0.5, 0.95).slice(1),
    [0.95 + 0.05 / 3, 0],
    [0.95 + 0.1 / 3, 0],
    [1, 0],
  ],
];

/** Lays a knob along `a` → `b`, protruding towards +x / +y when `dir` is 1. */
function knobEdge(
  a: Point,
  b: Point,
  horizontal: boolean,
  depth: number,
  dir: 1 | -1,
  chain: Chain,
): Edge {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // Unit normal pointing to +y for horizontal edges and to +x for vertical ones.
  const nx = (horizontal ? -dy : dy) / len;
  const ny = (horizontal ? dx : -dx) / len;
  const pts = chain.map(([l, k]) => ({
    x: a.x + dx * l + nx * k * depth * dir,
    y: a.y + dy * l + ny * k * depth * dir,
  }));
  return { pts, dir };
}

function generateUnusual(layout: Layout, seed: number): PieceShape[] {
  const { cols, rows, pieceW: w, pieceH: h } = layout;
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const depth = Math.min(w, h);
  const flip = (): 1 | -1 => (rnd() < 0.5 ? 1 : -1);
  const knob = () => KNOBS[Math.floor(rnd() * KNOBS.length)](rnd);

  // Grid corners, nudged off the grid. Corners on the border only slide along
  // it, so the outside of the puzzle stays a straight rectangle.
  const jx = 0.12 * w;
  const jy = 0.12 * h;
  const corner: Point[][] = [];
  for (let r = 0; r <= rows; r++) {
    corner.push([]);
    for (let c = 0; c <= cols; c++) {
      const sx = c === 0 || c === cols ? 0 : (rnd() * 2 - 1) * jx;
      const sy = r === 0 || r === rows ? 0 : (rnd() * 2 - 1) * jy;
      corner[r].push({ x: c * w + sx, y: r * h + sy });
    }
  }

  const horiz: (Edge | null)[][] = [];
  for (let r = 0; r <= rows; r++) {
    horiz.push([]);
    for (let c = 0; c < cols; c++) {
      horiz[r].push(
        r === 0 || r === rows
          ? null
          : knobEdge(corner[r][c], corner[r][c + 1], true, depth, flip(), knob()),
      );
    }
  }
  const vert: (Edge | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    vert.push([]);
    for (let c = 0; c <= cols; c++) {
      vert[r].push(
        c === 0 || c === cols
          ? null
          : knobEdge(corner[r][c], corner[r + 1][c], false, depth, flip(), knob()),
      );
    }
  }

  const pieces: PieceShape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pieces.push(
        assemble(
          r * cols + c,
          c,
          r,
          [horiz[r][c], vert[r][c + 1], horiz[r + 1][c], vert[r][c]],
          [corner[r][c], corner[r][c + 1], corner[r + 1][c + 1], corner[r + 1][c]],
          { x: c * w, y: r * h },
        ),
      );
    }
  }
  return pieces;
}
