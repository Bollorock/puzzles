// Horizontally scrollable storage of pieces locked to the bottom of the screen.
// Swipe sideways to scroll, drag a piece upwards to pull it onto the board,
// or tap it to drop it in the middle of the view. Scrolling is handled here
// rather than natively so that a swipe has to travel clearly sideways before
// it scrolls, which keeps slightly slanted pulls from being taken as scrolls.

import type { Game, TrayFilter } from './game';
import { drawThumb, type PieceSprite } from './render';

export interface TrayHooks {
  tap(pid: number): void;
  dragOut(pid: number, e: PointerEvent): void;
}

const THUMB = 64;
/** Sideways travel (px) before a swipe starts scrolling the strip. */
const SCROLL_SLOP = 28;
/** Upward travel (px) before a press on a piece turns into pulling it out. */
const PULL_SLOP = 10;
/** Momentum decay per millisecond after a swipe is released. */
const FRICTION = 0.995;

export class Tray {
  filter: TrayFilter = 'all';
  private readonly items = new Map<number, HTMLElement>();
  private press: {
    pid: number | null;
    id: number;
    x: number;
    y: number;
    t: number;
    moved: boolean;
  } | null = null;
  private swipe: {
    id: number;
    x: number;
    left: number;
    lastX: number;
    lastT: number;
    v: number;
  } | null = null;
  private glide = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly scroller: HTMLElement,
    private readonly list: HTMLElement,
    private readonly count: HTMLElement,
    private readonly game: Game,
    sprites: PieceSprite[],
    private readonly hooks: TrayHooks,
  ) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const pid of game.trayOrder) {
      const el = document.createElement('div');
      el.className = 'tray-item';
      el.dataset.pid = String(pid);
      const c = document.createElement('canvas');
      c.width = c.height = Math.round(THUMB * dpr);
      drawThumb(c, sprites[pid].canvas);
      el.append(c);
      this.items.set(pid, el);
    }
    const opts = { signal: this.abort.signal };
    scroller.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener(
      'pointercancel',
      () => {
        this.press = null;
        this.swipe = null;
      },
      opts,
    );
    // Let a vertical mouse wheel scroll the strip sideways on desktop.
    scroller.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          scroller.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { ...opts, passive: false },
    );
    this.refresh();
  }

  destroy() {
    this.abort.abort();
    cancelAnimationFrame(this.glide);
  }

  setFilter(f: TrayFilter) {
    this.filter = f;
    cancelAnimationFrame(this.glide);
    this.scroller.scrollLeft = 0;
    this.refresh();
  }

  refresh() {
    const pids = this.game.trayPieces(this.filter);
    const frag = document.createDocumentFragment();
    for (const pid of pids) frag.append(this.items.get(pid)!);
    this.list.replaceChildren(frag);
    const total = this.game.trayPieces('all').length;
    this.count.textContent = this.filter === 'all' ? `${total}` : `${pids.length} / ${total}`;
    this.list.classList.toggle('empty', pids.length === 0);
  }

  private onDown(e: PointerEvent) {
    // Leave scrollbar drags and non-primary buttons to the browser.
    if (this.press || this.swipe || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target === this.scroller) return;
    cancelAnimationFrame(this.glide);
    const el = (e.target as HTMLElement).closest<HTMLElement>('.tray-item');
    this.press = {
      pid: el ? Number(el.dataset.pid) : null,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      moved: false,
    };
  }

  private onMove(e: PointerEvent) {
    const s = this.swipe;
    if (s && s.id === e.pointerId) {
      const now = performance.now();
      const dt = now - s.lastT;
      if (dt > 0) s.v = 0.8 * ((s.lastX - e.clientX) / dt) + 0.2 * s.v;
      s.lastX = e.clientX;
      s.lastT = now;
      this.scroller.scrollLeft = s.left - (e.clientX - s.x);
      return;
    }
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) > PULL_SLOP) p.moved = true;
    if (p.pid !== null && dy < -PULL_SLOP && -dy > Math.abs(dx) * 0.7) {
      this.press = null;
      this.hooks.dragOut(p.pid, e);
    } else if (Math.abs(dx) > SCROLL_SLOP && Math.abs(dx) > Math.abs(dy)) {
      // Clearly sideways: start scrolling from here, so the strip doesn't jump.
      this.press = null;
      this.swipe = {
        id: e.pointerId,
        x: e.clientX,
        left: this.scroller.scrollLeft,
        lastX: e.clientX,
        lastT: performance.now(),
        v: 0,
      };
    } else if (dy > SCROLL_SLOP) {
      this.press = null;
    }
  }

  private onUp(e: PointerEvent) {
    const s = this.swipe;
    if (s && s.id === e.pointerId) {
      this.swipe = null;
      // A finger held still before lifting shouldn't fling the strip.
      if (performance.now() - s.lastT < 80) this.coast(s.v);
      return;
    }
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (p.pid !== null && !p.moved && performance.now() - p.t < 500) this.hooks.tap(p.pid);
  }

  /** Keeps the strip moving after a flick, slowing down until it stops. */
  private coast(v: number) {
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      const before = this.scroller.scrollLeft;
      this.scroller.scrollLeft += v * dt;
      v *= FRICTION ** dt;
      if (Math.abs(v) > 0.02 && this.scroller.scrollLeft !== before) {
        this.glide = requestAnimationFrame(step);
      }
    };
    this.glide = requestAnimationFrame(step);
  }
}
