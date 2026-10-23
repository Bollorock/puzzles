import './style.css';
import { Board } from './board';
import { previewSound, snapFeedback, unlockAudio, winFeedback } from './feedback';
import { Game, type SavedGame, type TrayFilter } from './game';
import { gridFor, PIECE_COUNTS } from './geometry';
import { fetchBlob, fullUrl, listPhotos, prepareImage, thumbUrl, type PicsumPhoto } from './images';
import {
  dragOffset,
  lsGet,
  lsSet,
  offsetVector,
  setDragOffset,
  setSetting,
  settings,
  type OffsetDir,
  type OffsetDist,
  type Settings,
} from './prefs';
import { renderPieces, renderScaleFor } from './render';
import { clearSaved, loadSaved, saveImage, saveState } from './storage';
import { Tray } from './tray';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Selection =
  | { kind: 'picsum'; photo: PicsumPhoto }
  | { kind: 'file'; file: File; url: string; aspect: number };

let selection: Selection | null = null;
let pieceCount = Number(lsGet('pieces')) || 48;
let galleryPage = 1;

// ---- small UI helpers ---------------------------------------------------

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2200);
}

const loading = (on: boolean) => ($('loading').hidden = !on);

function show(screen: 'home' | 'play') {
  $('home').hidden = screen !== 'home';
  $('play').hidden = screen !== 'play';
}

function formatTime(ms: number) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// ---- home screen --------------------------------------------------------

function selectionAspect(): number | null {
  if (!selection) return null;
  return selection.kind === 'picsum'
    ? selection.photo.width / selection.photo.height
    : selection.aspect;
}

function updateStartPanel() {
  const sel = $('selected');
  sel.replaceChildren();
  sel.classList.toggle('empty', !selection);
  if (selection) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = selection.kind === 'picsum' ? thumbUrl(selection.photo.id, 160) : selection.url;
    sel.append(img);
  } else {
    sel.innerHTML = '<span>No image</span>';
  }
  const aspect = selectionAspect();
  if (aspect) {
    const { cols, rows } = gridFor(pieceCount, aspect);
    $('grid-info').textContent = `· ${cols} × ${rows} = ${cols * rows}`;
  } else {
    $('grid-info').textContent = '';
  }
  $<HTMLButtonElement>('btn-start').disabled = !selection;
  for (const b of $('counts').querySelectorAll('button')) {
    b.classList.toggle('on', Number(b.dataset.n) === pieceCount);
  }
}

function buildCounts() {
  const wrap = $('counts');
  for (const n of PIECE_COUNTS) {
    const b = document.createElement('button');
    b.textContent = String(n);
    b.dataset.n = String(n);
    b.addEventListener('click', () => {
      pieceCount = n;
      lsSet('pieces', String(n));
      updateStartPanel();
    });
    wrap.append(b);
  }
}

function markGallerySelection() {
  for (const b of $('gallery').querySelectorAll<HTMLElement>('button')) {
    b.classList.toggle('on', selection?.kind === 'picsum' && selection.photo.id === b.dataset.id);
  }
}

async function loadGallery(reset: boolean) {
  const more = $<HTMLButtonElement>('btn-more');
  more.disabled = true;
  try {
    if (reset) {
      // Picsum has ~1000 photos; start somewhere random for variety.
      galleryPage = 1 + Math.floor(Math.random() * 38);
      $('gallery').replaceChildren();
    }
    const photos = await listPhotos(galleryPage++);
    const frag = document.createDocumentFragment();
    for (const photo of photos) {
      const b = document.createElement('button');
      b.dataset.id = photo.id;
      b.setAttribute('aria-label', `Photo by ${photo.author}`);
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = thumbUrl(photo.id);
      b.append(img);
      b.addEventListener('click', () => {
        selection = { kind: 'picsum', photo };
        markGallerySelection();
        updateStartPanel();
      });
      frag.append(b);
    }
    $('gallery').append(frag);
    markGallerySelection();
  } catch {
    toast('Could not load free photos. You can still use your own.');
  } finally {
    more.disabled = false;
  }
}

async function onFile(file: File) {
  try {
    const bmp = await createImageBitmap(file);
    const aspect = bmp.width / bmp.height;
    bmp.close();
    if (selection?.kind === 'file') URL.revokeObjectURL(selection.url);
    selection = { kind: 'file', file, url: URL.createObjectURL(file), aspect };
    markGallerySelection();
    updateStartPanel();
  } catch {
    toast('That file could not be opened as an image.');
  }
}

async function refreshContinue() {
  const saved = await loadSaved();
  const card = $('continue');
  card.hidden = !saved;
  if (!saved) return;
  const img = $<HTMLImageElement>('continue-img');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(saved.image);
  const { state } = saved;
  const total = state.cols * state.rows;
  const placed = state.pieceGroup.filter((g) => g !== -1).length;
  $('continue-info').textContent =
    `${total} pieces · ${placed} on board · ${formatTime(state.elapsedMs)}`;
}

// ---- play session -------------------------------------------------------

interface Session {
  game: Game;
  board: Board;
  tray: Tray;
  credit: string;
  elapsedBase: number;
  resumedAt: number;
  saveTimer: number;
  finished: boolean;
}

let session: Session | null = null;

function elapsed(s: Session) {
  return s.elapsedBase + (document.hidden ? 0 : performance.now() - s.resumedAt);
}

function snapshot(s: Session): SavedGame {
  return s.game.toSave({
    credit: s.credit,
    camera: { ...s.board.camera },
    filter: s.tray.filter,
    elapsedMs: elapsed(s),
  });
}

function scheduleSave() {
  const s = session;
  if (!s || s.finished) return;
  clearTimeout(s.saveTimer);
  s.saveTimer = window.setTimeout(() => void saveState(snapshot(s)).catch(() => {}), 400);
}

function saveNow() {
  const s = session;
  if (!s || s.finished) return;
  clearTimeout(s.saveTimer);
  void saveState(snapshot(s)).catch(() => {});
}

function updateProgress(s: Session) {
  const total = s.game.pieces.length;
  let joined = 0;
  for (const g of s.game.groups.values()) {
    if (g.pieces.length > 1 || g.locked) joined += g.pieces.length;
  }
  $('progress').textContent = `${joined} / ${total}`;
}

function setFilterButtons(f: TrayFilter) {
  for (const b of $('tray').querySelectorAll<HTMLElement>('.seg button')) {
    b.classList.toggle('on', b.dataset.filter === f);
  }
}

function startSession(game: Game, image: ImageBitmap, credit: string, saved?: SavedGame) {
  endSession();
  const scale = renderScaleFor(game.layout);
  const sprites = renderPieces(image, game.layout, game.pieces, scale);
  image.close();
  show('play');

  const trayEl = $('tray');
  const topbar = $('topbar');
  const s: Session = {
    game,
    credit,
    elapsedBase: saved?.elapsedMs ?? 0,
    resumedAt: performance.now(),
    saveTimer: 0,
    finished: false,
  } as Session;

  s.board = new Board(
    $<HTMLCanvasElement>('board'),
    $<HTMLCanvasElement>('drag-layer'),
    game,
    sprites,
    scale,
    {
      viewport: () => {
        const top = topbar.getBoundingClientRect().bottom;
        const bottom = trayEl.getBoundingClientRect().top;
        return new DOMRect(0, top, window.innerWidth, Math.max(50, bottom - top));
      },
      overTray: (_x, y) => y >= trayEl.getBoundingClientRect().top,
      changed: (kind) => {
        if (kind === 'tray') s.tray.refresh();
        updateProgress(s);
        scheduleSave();
        if (kind !== 'camera' && game.isComplete) finish(s);
      },
      snapped: snapFeedback,
      panZoom: () => settings.panZoom,
      dragOffset: () => offsetVector(dragOffset.dir, dragOffset.dist),
    },
  );
  s.tray = new Tray($('tray-scroll'), $('tray-items'), $('tray-count'), game, sprites, {
    tap: (pid) => s.board.placeInView(pid),
    dragOut: (pid, e) => s.board.dragFromTray(pid, e),
  });
  if (saved?.filter) {
    s.tray.setFilter(saved.filter);
  }
  setFilterButtons(s.tray.filter);
  if (saved?.camera && settings.panZoom) {
    s.board.camera = { ...saved.camera };
    s.board.requestDraw();
  } else {
    s.board.fit();
  }
  session = s;
  updateProgress(s);
  saveNow();
}

function endSession() {
  if (!session) return;
  saveNow();
  session.board.destroy();
  session.tray.destroy();
  session = null;
}

function finish(s: Session) {
  if (s.finished) return;
  s.finished = true;
  s.elapsedBase = elapsed(s);
  clearTimeout(s.saveTimer);
  void clearSaved().catch(() => {});
  $('done-info').textContent = `${s.game.pieces.length} pieces in ${formatTime(s.elapsedBase)}`;
  $('done-credit').textContent = s.credit;
  winFeedback();
  setTimeout(() => {
    $('done').hidden = false;
    s.board.fit();
  }, 350);
}

async function startNew() {
  if (!selection) return;
  loading(true);
  try {
    const sel = selection;
    const source = sel.kind === 'picsum' ? await fetchBlob(fullUrl(sel.photo)) : sel.file;
    const { blob, bitmap } = await prepareImage(source);
    const { cols, rows } = gridFor(pieceCount, bitmap.width / bitmap.height);
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const game = new Game(seed, bitmap.width, bitmap.height, cols, rows);
    const credit = sel.kind === 'picsum' ? `Photo by ${sel.photo.author} on Unsplash` : '';
    await saveImage(blob).catch(() => {});
    startSession(game, bitmap, credit);
  } catch (e) {
    console.error(e);
    toast('Could not load that image. Check your connection and try again.');
  } finally {
    loading(false);
  }
}

async function resume() {
  loading(true);
  try {
    const saved = await loadSaved();
    if (!saved) throw new Error('nothing saved');
    const bitmap = await createImageBitmap(saved.image);
    startSession(Game.fromSave(saved.state), bitmap, saved.state.credit, saved.state);
  } catch (e) {
    console.error(e);
    toast('Could not restore the saved puzzle.');
    $('continue').hidden = true;
  } finally {
    loading(false);
  }
}

function goHome() {
  endSession();
  $('done').hidden = true;
  show('home');
  void refreshContinue();
}

// ---- wiring -------------------------------------------------------------

function init() {
  buildCounts();
  updateStartPanel();
  void loadGallery(true);
  void refreshContinue();

  $('btn-more').addEventListener('click', () => void loadGallery(false));
  $('btn-shuffle').addEventListener('click', () => void loadGallery(true));
  $<HTMLInputElement>('file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void onFile(f);
    input.value = '';
  });
  $('btn-start').addEventListener('click', () => void startNew());
  $('btn-continue').addEventListener('click', () => void resume());

  $('btn-home').addEventListener('click', goHome);
  $('btn-done-home').addEventListener('click', goHome);
  $('btn-done-close').addEventListener('click', () => ($('done').hidden = true));
  $('btn-fit').addEventListener('click', () => session?.board.fit());
  $('btn-gather').addEventListener('click', () => {
    const s = session;
    if (!s) return;
    const n = s.game.gatherSingles();
    s.tray.refresh();
    s.board.requestDraw();
    updateProgress(s);
    scheduleSave();
    toast(n ? `Moved ${n} piece${n === 1 ? '' : 's'} to storage` : 'No single pieces on the board');
  });
  for (const b of $('tray').querySelectorAll<HTMLElement>('.seg button')) {
    b.addEventListener('click', () => {
      const s = session;
      if (!s) return;
      s.tray.setFilter(b.dataset.filter as TrayFilter);
      setFilterButtons(s.tray.filter);
      scheduleSave();
    });
  }

  // Settings sheet, reachable from the home screen and the game.
  const settingsSheet = $('settings');
  for (const key of ['sound', 'vibration', 'panZoom'] as (keyof Settings)[]) {
    const input = $<HTMLInputElement>(`set-${key}`);
    input.checked = settings[key];
    input.addEventListener('change', () => {
      setSetting(key, input.checked);
      if (key === 'sound' && input.checked) {
        previewSound();
      } else if (key === 'vibration' && input.checked) {
        navigator.vibrate?.(15);
      } else if (key === 'panZoom' && !input.checked) {
        session?.board.fit();
      }
    });
  }
  const offsetDir = $('set-offsetDir');
  const offsetDist = $('set-offsetDist');
  const showOffset = () => {
    for (const [group, value] of [
      [offsetDir, dragOffset.dir],
      [offsetDist, dragOffset.dist],
    ] as const) {
      for (const b of group.querySelectorAll<HTMLElement>('button')) {
        const on = b.dataset.value === value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    }
    offsetDist.classList.toggle('disabled', dragOffset.dir === 'off');
  };
  offsetDir.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) setDragOffset(b.dataset.value as OffsetDir, dragOffset.dist);
    showOffset();
  });
  offsetDist.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    // Picking a distance while off turns the lift on, pointing up.
    const dir = dragOffset.dir === 'off' ? 'up' : dragOffset.dir;
    setDragOffset(dir, b.dataset.value as OffsetDist);
    showOffset();
  });
  showOffset();
  if (!('vibrate' in navigator)) $('vibration-note').hidden = false;
  for (const id of ['btn-settings', 'btn-settings-play']) {
    $(id).addEventListener('click', () => (settingsSheet.hidden = false));
  }
  $('btn-settings-close').addEventListener('click', () => (settingsSheet.hidden = true));
  settingsSheet.addEventListener('click', (e) => {
    if (e.target === settingsSheet) settingsSheet.hidden = true;
  });
  // Audio can only start after a user gesture.
  window.addEventListener('pointerdown', unlockAudio, { capture: true });

  document.addEventListener('visibilitychange', () => {
    const s = session;
    if (!s || s.finished) return;
    if (document.hidden) {
      s.elapsedBase += performance.now() - s.resumedAt;
      saveNow();
    } else {
      s.resumedAt = performance.now();
    }
  });
  window.addEventListener('pagehide', saveNow);

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
