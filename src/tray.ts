// Horizontally scrollable storage of pieces locked to the bottom of the screen.
// Swipe sideways to scroll, drag a piece upwards to pull it onto the board,
// or tap it to drop it in the middle of the view.

import type { Game, TrayFilter } from './game';
import { drawThumb, type PieceSprite } from './render';

export interface TrayHooks {
  tap(pid: number): void;
  dragOut(pid: number, e: PointerEvent): void;
}

const THUMB = 64;

export class Tray {
  filter: TrayFilter = 'all';
  private readonly items = new Map<number, HTMLElement>();
  private press: { pid: number; id: number; x: number; y: number; t: number } | null = null;
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
    list.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener('pointercancel', () => (this.press = null), opts);
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
  }

  setFilter(f: TrayFilter) {
    this.filter = f;
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
    const el = (e.target as HTMLElement).closest<HTMLElement>('.tray-item');
    if (!el || this.press) return;
    this.press = {
      pid: Number(el.dataset.pid),
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    };
  }

  private onMove(e: PointerEvent) {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (dy < -10 && Math.abs(dy) > Math.abs(dx)) {
      this.press = null;
      this.hooks.dragOut(p.pid, e);
    } else if (Math.abs(dx) > 10 || dy > 10) {
      // Horizontal swipe: leave it to native scrolling.
      this.press = null;
    }
  }

  private onUp(e: PointerEvent) {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (performance.now() - p.t < 500) this.hooks.tap(p.pid);
  }
}
