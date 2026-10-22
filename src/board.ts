// The play surface: draws groups of pieces, handles pan / pinch zoom and
// dragging, including drags that start in the storage tray.

import type { Game } from './game';
import type { PieceSprite } from './render';

export interface Camera {
  /** Screen = board * zoom + (x, y), in CSS pixels. */
  x: number;
  y: number;
  zoom: number;
}

export interface BoardHooks {
  /** Visible board area in client coordinates (between top bar and tray). */
  viewport(): DOMRect;
  /** True when a client point is over the tray. */
  overTray(clientX: number, clientY: number): boolean;
  /** Something changed that should be saved / reflected in the UI. */
  changed(kind: 'move' | 'tray' | 'camera'): void;
  snapped(): void;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'pan'; id: number; lastX: number; lastY: number }
  | {
      kind: 'pinch';
      a: number;
      b: number;
      anchorX: number;
      anchorY: number;
      dist: number;
      zoom: number;
    }
  | { kind: 'drag'; id: number; gid: number; offX: number; offY: number; fromTray: boolean };

export class Board {
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dragCtx: CanvasRenderingContext2D;
  private readonly hitCtx = document.createElement('canvas').getContext('2d')!;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = { kind: 'idle' };
  private dpr = 1;
  private drawQueued = false;
  private staticDirty = true;
  private destroyed = false;
  private readonly offsets: { left: number; top: number } = { left: 0, top: 0 };
  private readonly abort = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly dragCanvas: HTMLCanvasElement,
    private readonly game: Game,
    private readonly sprites: PieceSprite[],
    private readonly renderScale: number,
    private readonly hooks: BoardHooks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.dragCtx = dragCanvas.getContext('2d')!;
    const opts = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { ...opts, passive: false });
    window.addEventListener('resize', () => this.resize(), opts);
    this.resize();
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
  }

  // ---- geometry helpers -------------------------------------------------

  private toBoard(clientX: number, clientY: number) {
    const x = clientX - this.offsets.left;
    const y = clientY - this.offsets.top;
    return { x: (x - this.camera.x) / this.camera.zoom, y: (y - this.camera.y) / this.camera.zoom };
  }

  private get unit() {
    const { pieceW, pieceH } = this.game.layout;
    return Math.min(pieceW, pieceH);
  }

  private zoomLimits() {
    const vp = this.hooks.viewport();
    const { width, height } = this.game.layout;
    const fit = Math.min(vp.width / width, vp.height / height);
    return {
      min: fit * 0.2,
      max: Math.max(fit * 2, (Math.min(vp.width, vp.height) * 0.7) / this.unit),
    };
  }

  private setZoomAround(zoom: number, sx: number, sy: number, bx: number, by: number) {
    const { min, max } = this.zoomLimits();
    const z = Math.min(max, Math.max(min, zoom));
    this.camera = { zoom: z, x: sx - bx * z, y: sy - by * z };
  }

  /** Fits the puzzle frame plus every piece on the board into view. */
  fit() {
    const { width, height, pad } = this.game.layout;
    let x0 = 0;
    let y0 = 0;
    let x1 = width;
    let y1 = height;
    for (const g of this.game.groups.values()) {
      for (const pid of g.pieces) {
        const p = this.game.piecePos(pid);
        x0 = Math.min(x0, p.x - pad);
        y0 = Math.min(y0, p.y - pad);
        x1 = Math.max(x1, p.x + this.game.layout.pieceW + pad);
        y1 = Math.max(y1, p.y + this.game.layout.pieceH + pad);
      }
    }
    const vp = this.hooks.viewport();
    const margin = 16;
    const zoom = Math.min(
      (vp.width - margin * 2) / (x1 - x0),
      (vp.height - margin * 2) / (y1 - y0),
    );
    const vx = vp.left - this.offsets.left + vp.width / 2;
    const vy = vp.top - this.offsets.top + vp.height / 2;
    this.camera = { zoom, x: vx - ((x0 + x1) / 2) * zoom, y: vy - ((y0 + y1) / 2) * zoom };
    this.requestDraw();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.dragCanvas]) {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    const r = this.canvas.getBoundingClientRect();
    this.offsets.left = r.left;
    this.offsets.top = r.top;
    this.requestDraw();
  }

  // ---- tray interaction -------------------------------------------------

  /** Places a tray piece somewhere near the middle of the visible board. */
  placeInView(pid: number) {
    const vp = this.hooks.viewport();
    const { pieceW, pieceH } = this.game.layout;
    const jitter = () => (Math.random() - 0.5) * Math.min(vp.width, vp.height) * 0.4;
    const c = this.toBoard(vp.left + vp.width / 2 + jitter(), vp.top + vp.height / 2 + jitter());
    this.game.placeFromTray(pid, c.x - pieceW / 2, c.y - pieceH / 2);
    this.hooks.changed('tray');
    this.requestDraw();
  }

  /** Starts dragging a piece straight out of the tray under the given pointer. */
  dragFromTray(pid: number, e: PointerEvent) {
    if (this.mode.kind !== 'idle') return;
    const { pieceW, pieceH } = this.game.layout;
    const b = this.toBoard(e.clientX, e.clientY);
    // Keep the piece a little above the finger so it stays visible.
    const lift = 28 / this.camera.zoom;
    const g = this.game.placeFromTray(pid, b.x - pieceW / 2, b.y - pieceH / 2 - lift);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.mode = {
      kind: 'drag',
      id: e.pointerId,
      gid: g.id,
      offX: b.x - g.x,
      offY: b.y - g.y,
      fromTray: true,
    };
    this.hooks.changed('tray');
    this.requestDraw();
  }

  // ---- pointer handling -------------------------------------------------

  private hitTest(clientX: number, clientY: number): number | null {
    const b = this.toBoard(clientX, clientY);
    const { pieceW, pieceH, pad } = this.game.layout;
    const slack = 10 / this.camera.zoom;
    let fallback: number | null = null;
    for (let i = this.game.zOrder.length - 1; i >= 0; i--) {
      const g = this.game.groups.get(this.game.zOrder[i])!;
      for (const pid of g.pieces) {
        const p = this.game.piecePos(pid);
        const lx = b.x - p.x;
        const ly = b.y - p.y;
        if (lx < -pad || ly < -pad || lx > pieceW + pad || ly > pieceH + pad) continue;
        if (this.hitCtx.isPointInPath(this.sprites[pid].path, lx, ly)) return g.id;
        if (
          fallback === null &&
          lx > -slack &&
          ly > -slack &&
          lx < pieceW + slack &&
          ly < pieceH + slack
        ) {
          fallback = g.id;
        }
      }
    }
    return fallback;
  }

  private onDown(e: PointerEvent) {
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.mode.kind === 'idle') {
      const gid = this.hitTest(e.clientX, e.clientY);
      if (gid !== null) {
        const g = this.game.groups.get(gid)!;
        const b = this.toBoard(e.clientX, e.clientY);
        this.game.bringToFront(gid);
        this.mode = {
          kind: 'drag',
          id: e.pointerId,
          gid,
          offX: b.x - g.x,
          offY: b.y - g.y,
          fromTray: false,
        };
      } else {
        this.mode = { kind: 'pan', id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      }
      this.requestDraw();
    } else if (this.mode.kind === 'pan' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.keys()];
      this.startPinch(a, b);
    }
  }

  private startPinch(a: number, b: number) {
    const pa = this.pointers.get(a)!;
    const pb = this.pointers.get(b)!;
    const anchor = this.toBoard((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    this.mode = {
      kind: 'pinch',
      a,
      b,
      anchorX: anchor.x,
      anchorY: anchor.y,
      dist: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
      zoom: this.camera.zoom,
    };
  }

  private onMove(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = this.mode;
    if (m.kind === 'pan' && m.id === e.pointerId) {
      this.camera.x += e.clientX - m.lastX;
      this.camera.y += e.clientY - m.lastY;
      m.lastX = e.clientX;
      m.lastY = e.clientY;
      this.requestDraw();
    } else if (m.kind === 'pinch' && (m.a === e.pointerId || m.b === e.pointerId)) {
      const pa = this.pointers.get(m.a)!;
      const pb = this.pointers.get(m.b)!;
      const dist = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
      const sx = (pa.x + pb.x) / 2 - this.offsets.left;
      const sy = (pa.y + pb.y) / 2 - this.offsets.top;
      this.setZoomAround((m.zoom * dist) / m.dist, sx, sy, m.anchorX, m.anchorY);
      this.requestDraw();
    } else if (m.kind === 'drag' && m.id === e.pointerId) {
      const b = this.toBoard(e.clientX, e.clientY);
      this.game.moveGroup(m.gid, b.x - m.offX, b.y - m.offY);
      this.requestDraw(true);
    }
  }

  private onUp(e: PointerEvent) {
    if (!this.pointers.delete(e.pointerId)) return;
    const m = this.mode;
    if (m.kind === 'drag' && m.id === e.pointerId) {
      this.mode = { kind: 'idle' };
      const g = this.game.groups.get(m.gid)!;
      if (g.pieces.length === 1 && this.hooks.overTray(e.clientX, e.clientY)) {
        this.game.returnToTray(m.gid);
        this.hooks.changed('tray');
      } else {
        const tolerance = Math.min(
          this.unit * 0.45,
          Math.max(this.unit * 0.22, 14 / this.camera.zoom),
        );
        const { snapped } = this.game.snap(m.gid, tolerance);
        if (snapped) this.hooks.snapped();
        this.hooks.changed(m.fromTray ? 'tray' : 'move');
      }
      this.requestDraw();
    } else if (m.kind === 'pinch' && (m.a === e.pointerId || m.b === e.pointerId)) {
      const rest = m.a === e.pointerId ? m.b : m.a;
      const p = this.pointers.get(rest);
      this.mode = p ? { kind: 'pan', id: rest, lastX: p.x, lastY: p.y } : { kind: 'idle' };
      this.hooks.changed('camera');
    } else if (m.kind === 'pan' && m.id === e.pointerId) {
      this.mode = { kind: 'idle' };
      this.hooks.changed('camera');
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const sx = e.clientX - this.offsets.left;
    const sy = e.clientY - this.offsets.top;
    if (e.ctrlKey || !e.deltaX) {
      // Mouse wheel or trackpad pinch (ctrlKey) zooms around the cursor.
      const b = this.toBoard(e.clientX, e.clientY);
      this.setZoomAround(
        this.camera.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
        sx,
        sy,
        b.x,
        b.y,
      );
    } else {
      this.camera.x -= e.deltaX;
      this.camera.y -= e.deltaY;
    }
    this.requestDraw();
    this.hooks.changed('camera');
  }

  // ---- drawing ----------------------------------------------------------

  /** Schedules a redraw; `dragOnly` skips repainting the static layer. */
  requestDraw(dragOnly = false) {
    if (!dragOnly) this.staticDirty = true;
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      if (!this.destroyed) this.draw();
    });
  }

  private draw() {
    const dragging = this.mode.kind === 'drag' ? this.mode.gid : null;
    if (this.staticDirty) {
      this.staticDirty = false;
      this.paint(this.ctx, this.canvas, (gid) => gid !== dragging, true);
    }
    this.paint(this.dragCtx, this.dragCanvas, (gid) => gid === dragging, false);
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    include: (gid: number) => boolean,
    frame: boolean,
  ) {
    const { zoom, x, y } = this.camera;
    const { width, height, pieceW, pieceH, pad } = this.game.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(zoom * this.dpr, 0, 0, zoom * this.dpr, x * this.dpr, y * this.dpr);

    if (frame) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([6 / zoom, 6 / zoom]);
      ctx.strokeRect(0, 0, width, height);
      ctx.setLineDash([]);
    }

    // Visible board rectangle for culling.
    const vx0 = -x / zoom;
    const vy0 = -y / zoom;
    const vx1 = vx0 + canvas.width / this.dpr / zoom;
    const vy1 = vy0 + canvas.height / this.dpr / zoom;
    const sw = pieceW + 2 * pad;
    const sh = pieceH + 2 * pad;
    const s = this.renderScale;

    for (const gid of this.game.zOrder) {
      if (!include(gid)) continue;
      const g = this.game.groups.get(gid)!;
      for (const pid of g.pieces) {
        const p = this.game.piecePos(pid);
        const dx = p.x - pad;
        const dy = p.y - pad;
        if (dx > vx1 || dy > vy1 || dx + sw < vx0 || dy + sh < vy0) continue;
        const sprite = this.sprites[pid].canvas;
        ctx.drawImage(sprite, dx, dy, sprite.width / s, sprite.height / s);
      }
    }
  }
}
