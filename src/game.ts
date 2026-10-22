// Game state without any DOM: piece groups on the board, the storage tray,
// snapping and serialization.

import { generatePieces, makeLayout, mulberry32, type Layout, type PieceShape } from './geometry';

export type TrayFilter = 'all' | 'edge' | 'inner';

export interface Group {
  id: number;
  /** Board position of the puzzle origin for this group's pieces. */
  x: number;
  y: number;
  pieces: number[];
  /** Fixed at its true spot in the frame; it can no longer be dragged. */
  locked: boolean;
}

export interface SavedGame {
  version: 1;
  seed: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  credit: string;
  trayOrder: number[];
  /** Group id for each piece, or -1 when the piece is in the tray. */
  pieceGroup: number[];
  /** Groups in z order, bottom first. */
  groups: { id: number; x: number; y: number; locked?: boolean }[];
  camera?: { x: number; y: number; zoom: number };
  filter: TrayFilter;
  elapsedMs: number;
}

export class Game {
  readonly layout: Layout;
  readonly pieces: PieceShape[];
  /** Random but fixed order of pieces in the tray. */
  readonly trayOrder: number[];
  /** Group id per piece; -1 means in the tray. */
  readonly pieceGroup: number[];
  readonly groups = new Map<number, Group>();
  /** Group ids, bottom first. */
  zOrder: number[] = [];
  private nextGroupId = 1;

  constructor(
    readonly seed: number,
    width: number,
    height: number,
    cols: number,
    rows: number,
    trayOrder?: number[],
  ) {
    this.layout = makeLayout(width, height, cols, rows);
    this.pieces = generatePieces(this.layout, seed);
    this.pieceGroup = this.pieces.map(() => -1);
    this.trayOrder =
      trayOrder ??
      shuffle(
        this.pieces.map((p) => p.id),
        mulberry32(seed ^ 0x9e3779b9),
      );
  }

  static fromSave(s: SavedGame): Game {
    const g = new Game(s.seed, s.width, s.height, s.cols, s.rows, s.trayOrder);
    for (const sg of s.groups) {
      g.groups.set(sg.id, { id: sg.id, x: sg.x, y: sg.y, pieces: [], locked: !!sg.locked });
      g.zOrder.push(sg.id);
      g.nextGroupId = Math.max(g.nextGroupId, sg.id + 1);
    }
    s.pieceGroup.forEach((gid, pid) => {
      const group = g.groups.get(gid);
      if (group) {
        group.pieces.push(pid);
        g.pieceGroup[pid] = gid;
      }
    });
    // Drop any empty groups left by an inconsistent save.
    for (const [id, group] of g.groups) if (!group.pieces.length) g.removeGroup(id);
    return g;
  }

  toSave(extra: Pick<SavedGame, 'credit' | 'camera' | 'filter' | 'elapsedMs'>): SavedGame {
    const { cols, rows, width, height } = this.layout;
    return {
      version: 1,
      seed: this.seed,
      cols,
      rows,
      width,
      height,
      trayOrder: this.trayOrder,
      pieceGroup: [...this.pieceGroup],
      groups: this.zOrder.map((id) => {
        const g = this.groups.get(id)!;
        return { id, x: g.x, y: g.y, locked: g.locked };
      }),
      ...extra,
    };
  }

  inTray(pid: number): boolean {
    return this.pieceGroup[pid] === -1;
  }

  trayPieces(filter: TrayFilter): number[] {
    return this.trayOrder.filter(
      (pid) =>
        this.inTray(pid) && (filter === 'all' || (filter === 'edge') === this.pieces[pid].isEdge),
    );
  }

  get isComplete(): boolean {
    return (
      this.groups.size === 1 &&
      this.groups.values().next().value!.pieces.length === this.pieces.length
    );
  }

  get placedCount(): number {
    return this.pieceGroup.filter((g) => g !== -1).length;
  }

  /** Board position of a piece's rectangle top-left. */
  piecePos(pid: number): { x: number; y: number } {
    const g = this.groups.get(this.pieceGroup[pid])!;
    const p = this.pieces[pid];
    return { x: g.x + p.col * this.layout.pieceW, y: g.y + p.row * this.layout.pieceH };
  }

  /** Takes a piece out of the tray so its rectangle top-left lands at (x, y). */
  placeFromTray(pid: number, x: number, y: number): Group {
    if (!this.inTray(pid)) throw new Error(`piece ${pid} is not in the tray`);
    const p = this.pieces[pid];
    const group: Group = {
      id: this.nextGroupId++,
      x: x - p.col * this.layout.pieceW,
      y: y - p.row * this.layout.pieceH,
      pieces: [pid],
      locked: false,
    };
    this.groups.set(group.id, group);
    this.zOrder.push(group.id);
    this.pieceGroup[pid] = group.id;
    return group;
  }

  /** Puts a single-piece group back into the tray. Locked pieces stay put. */
  returnToTray(gid: number): boolean {
    const g = this.groups.get(gid);
    if (!g || g.locked || g.pieces.length !== 1) return false;
    this.pieceGroup[g.pieces[0]] = -1;
    this.removeGroup(gid);
    return true;
  }

  /** Moves every lone piece on the board back to the tray. Returns how many moved. */
  gatherSingles(): number {
    let n = 0;
    for (const g of this.groups.values()) if (this.returnToTray(g.id)) n++;
    return n;
  }

  bringToFront(gid: number) {
    this.zOrder = this.zOrder.filter((id) => id !== gid);
    this.zOrder.push(gid);
  }

  /** Locked groups sit below the loose pieces so those stay visible and grabbable. */
  sendToBack(gid: number) {
    this.zOrder = this.zOrder.filter((id) => id !== gid);
    this.zOrder.unshift(gid);
  }

  moveGroup(gid: number, x: number, y: number) {
    const g = this.groups.get(gid)!;
    if (g.locked) return;
    g.x = x;
    g.y = y;
  }

  /**
   * Joins the group with any neighbouring group whose pieces line up within
   * `tolerance` board units, and locks it into the frame when it holds a
   * corner piece that is that close to its true spot. Returns the id of the
   * resulting group and whether anything snapped.
   */
  snap(gid: number, tolerance: number): { gid: number; snapped: boolean } {
    let snapped = false;
    let current = gid;
    for (;;) {
      const target = this.findSnapTarget(current, tolerance);
      if (target !== null) {
        current = this.merge(current, target);
      } else if (!this.lockToFrame(current, tolerance)) {
        break;
      }
      snapped = true;
    }
    return { gid: current, snapped };
  }

  isCorner(pid: number): boolean {
    const { col, row } = this.pieces[pid];
    const { cols, rows } = this.layout;
    return (col === 0 || col === cols - 1) && (row === 0 || row === rows - 1);
  }

  /** Puts a group with a corner piece at its true spot and locks it there. */
  private lockToFrame(gid: number, tolerance: number): boolean {
    const g = this.groups.get(gid)!;
    if (g.locked || Math.hypot(g.x, g.y) > tolerance) return false;
    if (!g.pieces.some((pid) => this.isCorner(pid))) return false;
    g.x = 0;
    g.y = 0;
    g.locked = true;
    this.sendToBack(gid);
    return true;
  }

  private findSnapTarget(gid: number, tolerance: number): number | null {
    const g = this.groups.get(gid)!;
    const { cols, rows } = this.layout;
    let best: number | null = null;
    let bestDist = tolerance;
    for (const pid of g.pieces) {
      const { col, row } = this.pieces[pid];
      const neighbours = [
        row > 0 ? pid - cols : -1,
        row < rows - 1 ? pid + cols : -1,
        col > 0 ? pid - 1 : -1,
        col < cols - 1 ? pid + 1 : -1,
      ];
      for (const nid of neighbours) {
        if (nid < 0) continue;
        const ngid = this.pieceGroup[nid];
        if (ngid === -1 || ngid === gid) continue;
        const ng = this.groups.get(ngid)!;
        const d = Math.hypot(ng.x - g.x, ng.y - g.y);
        if (d <= bestDist) {
          bestDist = d;
          best = ngid;
        }
      }
    }
    return best;
  }

  /**
   * Merges `moving` into `target`, aligning to the target, or to whichever
   * group is locked into the frame. Returns the surviving id.
   */
  private merge(moving: number, target: number): number {
    const a = this.groups.get(moving)!;
    const b = this.groups.get(target)!;
    // Keep the bigger group's id so z order stays stable, but take the
    // moving group's z position (it was just dropped on top).
    const [keep, drop] = b.pieces.length >= a.pieces.length ? [b, a] : [a, b];
    const anchor = a.locked ? a : b;
    keep.x = anchor.x;
    keep.y = anchor.y;
    keep.locked = a.locked || b.locked;
    for (const pid of drop.pieces) {
      keep.pieces.push(pid);
      this.pieceGroup[pid] = keep.id;
    }
    this.removeGroup(drop.id);
    if (keep.locked) this.sendToBack(keep.id);
    else this.bringToFront(keep.id);
    return keep.id;
  }

  private removeGroup(gid: number) {
    this.groups.delete(gid);
    this.zOrder = this.zOrder.filter((id) => id !== gid);
  }
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
