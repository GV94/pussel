// The puzzle table: a board where pieces go, a scrollable tray holding the
// pieces not yet used, and the table around the board where pieces can be
// left anywhere. Pieces only stick when dropped near their correct spot, so
// there is nothing to rotate, link or untangle.

import { buildPieces, mulberry32, traceOutline, TAB_REACH, type PieceShape } from './geometry';
import type { BoardMode, PieceState, SavedGame } from '../storage';
import { playMiss, playPickup, playSnap, unlockAudio } from '../sound';

type Piece = {
  shape: PieceShape;
  state: PieceState;
  /** Top-left of the piece's cell, world units. Only meaningful on the table. */
  x: number;
  y: number;
  bitmap: HTMLCanvasElement | null;
};

type Rect = { x: number; y: number; w: number; h: number };

/** Where a touch started: a tray slot, the big focused piece, a loose piece, or the board. */
type Origin = 'tray' | 'big' | 'table' | 'board';

type Gesture =
  | { kind: 'pending'; id: number; startX: number; startY: number; piece: number | null; origin: Origin; timer: number }
  | { kind: 'drag'; id: number; piece: number; dx: number; dy: number; px: number; py: number }
  | { kind: 'scroll'; id: number; last: number; lastT: number; velocity: number }
  | { kind: 'pan'; id: number; x: number; y: number }
  /** Swiping the page of large pieces sideways. */
  | { kind: 'swipe'; id: number; start: number; last: number; lastT: number; velocity: number }
  /** A finger left over from a pinch; ignored until lifted. */
  | { kind: 'idle'; id: number };

/** Two fingers zooming the board. World point under the midpoint stays under it. */
type Pinch = { a: number; b: number; startDist: number; startZoom: number; wx: number; wy: number };

/** Short-lived outline on the board: a wrong guess, or a hint after several. */
type Flash = { col: number; row: number; kind: 'miss' | 'hint'; t0: number };

type SnapAnim = { piece: number; fromX: number; fromY: number; t0: number };

export type GameOptions = {
  image: HTMLImageElement;
  cols: number;
  rows: number;
  seed: number;
  saved?: SavedGame;
  board: BoardMode;
  onProgress: (placed: number, total: number) => void;
  onChange: () => void;
  onComplete: () => void;
  labels: { prev: string; next: string; all: string; big: string; pickHint: string; zoomIn: string; zoomOut: string };
};

/** Extra room around the cell in piece bitmaps: tabs plus the baked shadow. */
const PAD = TAB_REACH + 0.08;
/** Dragged pieces are drawn at least this big (CSS px), so a finger doesn't hide them. */
const DRAG_MIN_PX = 72;
/** And this far above the finger. */
const DRAG_LIFT_PX = 24;
/** Tray slot size relative to piece size. */
const SLOT = 1.65;
/** Pieces at least this big (CSS px, about 2.9 cm on an iPad) may give up size for extra tray lanes. */
const COMFORT_PX = 150;
/** One spacing unit and one control size for everything on the puzzle screen. */
const GAP = 12;
const CTL = 56;
/** Padding inside the tray. */
const INSET = 8;
const SNAP_MS = 140;
const MISS_MS = 700;
const HINT_MS = 2400;
/** Wrong guesses with the same piece before its spot is pointed out. */
const MISSES_BEFORE_HINT = 3;
/** Set once she has opened a piece, after which the "tap a piece" hint stops showing. */
const LEARNED_KEY = 'jigsaw.learnedTap';
const TOAST_MS = 5000;

export class PuzzleGame {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pieces: Piece[];
  private tray: number[] = [];
  private table: number[] = [];
  private gestures = new Map<number, Gesture>();
  private anims: SnapAnim[] = [];
  private img: HTMLImageElement;
  private crop: Rect;
  private cols: number;
  private rows: number;
  private seed: number;
  private board: BoardMode;
  private opts: GameOptions;

  // Layout, CSS px.
  private W = 0;
  private H = 0;
  private dpr = 1;
  private scale = 0; // px per world unit on the board
  private ox = 0; // screen x of world origin
  private oy = 0;
  private trayRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private trayVertical = true; // tray scrolls vertically (landscape) or horizontally
  private trayScale = 0;
  private trayCross = 1; // lanes of pieces across the tray
  private trayList: Rect = { x: 0, y: 0, w: 0, h: 0 }; // tray minus the arrow buttons
  private trayTarget: number | null = null; // animated scroll destination
  private bar = 0; // height of the strip above the tray on upright screens
  /** Area the board and loose pieces live in (everything but the tray). */
  private region: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Board layout at zoom 1. `scale`, `ox`, `oy` are the zoomed values. */
  private base = { scale: 0, ox: 0, oy: 0 };
  private zoom = 1;
  private pinch: Pinch | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private zoomBox: HTMLDivElement;
  private zoomInBtn: HTMLButtonElement;
  private zoomOutBtn: HTMLButtonElement;
  private rerenderTimer = 0;
  /** Device pixels per world unit actually used for piece bitmaps and the board layer. */
  private res = 0;
  private boardRes = 0;
  private arrowPrev: HTMLButtonElement;
  private arrowNext: HTMLButtonElement;
  private allButton: HTMLButtonElement;
  /** Short hint that fades out by itself, shown only until she has done the thing once. */
  private toast: HTMLDivElement;
  private toastTimer = 0;
  /** Preview mode: the whole picture shown clearly on the board, no outlines. */
  private preview = false;
  /** The selected piece: the one a tap on the board will try to place. */
  private focus: number | null = null;
  /**
   * 'big': the tray shows a page of large pieces (the default, and the only mode
   * on phones). 'grid': all pieces small, scrollable (iPad option).
   */
  private trayMode: 'big' | 'grid' = 'big';
  /** Index in the tray of the first piece on the current big page. */
  private pageStart = 0;
  /** Phones: the page arrows sit in the strip above the tray, giving pieces the full width. */
  private arrowsInBar = false;
  private bigBitmaps = new Map<number, HTMLCanvasElement>();
  /** How far the big page is dragged along the tray (px), and where it's animating to. */
  private swipeOffset = 0;
  private swipeTarget: number | null = null;
  private bigBitmapScale = 0;
  private misses = 0;
  private flashes: Flash[] = [];
  private trayScroll = 0;
  private trayVelocity = 0;

  private boardLayer: HTMLCanvasElement = document.createElement('canvas');
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;

  private container: HTMLElement;

  constructor(container: HTMLElement, opts: GameOptions) {
    this.container = container;
    this.opts = opts;
    this.img = opts.image;
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.seed = opts.seed;
    this.board = opts.board;
    this.crop = cropFor(this.img, this.cols / this.rows);

    const shapes = buildPieces({ cols: this.cols, rows: this.rows }, this.seed);
    const saved = opts.saved;
    this.pieces = shapes.map((shape, i) => ({
      shape,
      state: saved?.pieces[i].state ?? 'tray',
      x: saved?.pieces[i].x ?? 0,
      y: saved?.pieces[i].y ?? 0,
      bitmap: null,
    }));
    if (saved) {
      this.tray = saved.tray.filter((i) => this.pieces[i]?.state === 'tray');
      this.table = saved.table.filter((i) => this.pieces[i]?.state === 'table');
    } else {
      // Edge pieces first: the usual way people start, and the easiest.
      const rand = mulberry32(this.seed ^ 0x9e3779b9);
      const edges = shuffle(shapes.map((_, i) => i).filter((i) => shapes[i].isEdge), rand);
      const inner = shuffle(shapes.map((_, i) => i).filter((i) => !shapes[i].isEdge), rand);
      this.tray = [...edges, ...inner];
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'puzzle-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    container.appendChild(this.canvas);
    this.arrowPrev = arrowButton(opts.labels.prev, () => this.page(-1));
    this.arrowNext = arrowButton(opts.labels.next, () => this.page(1));
    this.allButton = document.createElement('button');
    this.allButton.className = 'tray-all ctl';
    this.allButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg><span></span>`;
    this.allButton.querySelector('span')!.textContent = opts.labels.all;
    this.allButton.addEventListener('click', () => {
      this.hideToast();
      this.setMode(this.trayMode === 'big' ? 'grid' : 'big');
    });
    this.toast = document.createElement('div');
    this.toast.className = 'hint-toast';
    this.toast.setAttribute('role', 'status');
    this.zoomBox = document.createElement('div');
    this.zoomBox.className = 'zoom-controls';
    this.zoomInBtn = zoomButton('+', opts.labels.zoomIn, () => this.zoomBy(1.6));
    this.zoomOutBtn = zoomButton('−', opts.labels.zoomOut, () => this.zoomBy(1 / 1.6));
    this.zoomBox.append(this.zoomInBtn, this.zoomOutBtn);
    container.append(this.arrowPrev, this.arrowNext, this.allButton, this.toast, this.zoomBox);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
    this.layout();
    this.focus = this.tray[0] ?? null;
    this.reportProgress();
    window.setTimeout(() => this.hintOnce(LEARNED_KEY, opts.labels.pickHint), 700);
  }

  get previewOn(): boolean {
    return this.preview;
  }

  setPreview(on: boolean): void {
    this.preview = on;
    this.requestDraw();
  }

  /** Show a hint the first time only, ever. */
  private hintOnce(key: string, text: string): void {
    if (localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    this.showToast(text);
  }

  private showToast(text: string): void {
    if (this.destroyed) return;
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideToast(), TOAST_MS);
  }

  private hideToast(): void {
    this.toast.classList.remove('show');
  }

  private learnedPlacing(): void {
    this.hideToast();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.remove();
    this.arrowPrev.remove();
    this.arrowNext.remove();
    this.allButton.remove();
    this.toast.remove();
    clearTimeout(this.toastTimer);
    this.zoomBox.remove();
    clearTimeout(this.rerenderTimer);
  }

  /** Next or previous page of large pieces, or scroll the small-piece grid. */
  page(dir: 1 | -1): void {
    this.hideToast();
    if (this.trayMode === 'big') {
      const { cells, length } = this.bigLayout();
      if (this.pageCount(cells.length) <= 1) return;
      this.finishSwipe();
      this.swipeTarget = -dir * length; // slide the page out, then show the next one
      playPickup();
      this.requestDraw();
      return;
    }
    const length = this.trayVertical ? this.trayList.h : this.trayList.w;
    const slot = this.slotSize();
    const step = Math.max(slot, Math.floor(length / slot) * slot);
    const from = this.trayTarget ?? this.trayScroll;
    this.trayTarget = clamp(from + dir * step, 0, this.maxTrayScroll());
    this.trayVelocity = 0;
    this.requestDraw();
  }

  get placedCount(): number {
    return this.pieces.filter((p) => p.state === 'placed').length;
  }

  get total(): number {
    return this.pieces.length;
  }

  get boardMode(): BoardMode {
    return this.board;
  }

  setBoardMode(mode: BoardMode): void {
    this.board = mode;
    this.renderBoardLayer();
    this.requestDraw();
    this.opts.onChange();
  }

  /** Put every loose piece back in the tray, edges first. */
  gatherPieces(): void {
    const loose = [...this.table, ...this.tray];
    const edges = loose.filter((i) => this.pieces[i].shape.isEdge);
    const inner = loose.filter((i) => !this.pieces[i].shape.isEdge);
    for (const i of this.table) this.pieces[i].state = 'tray';
    this.table = [];
    this.tray = [...edges, ...inner];
    this.trayScroll = 0;
    this.requestDraw();
    this.opts.onChange();
  }

  /** Crop of the source image actually used by the puzzle. */
  get croppedImage(): { img: HTMLImageElement; crop: Rect } {
    return { img: this.img, crop: this.crop };
  }

  toSaved(): Omit<SavedGame, 'image'> {
    return {
      version: 2,
      cols: this.cols,
      rows: this.rows,
      seed: this.seed,
      pieces: this.pieces.map((p) => ({ state: p.state, x: round3(p.x), y: round3(p.y) })),
      tray: [...this.tray],
      table: [...this.table],
      guide: this.board === 'full',
      board: this.board,
    };
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.W = rect.width;
    this.H = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;

    // Make pieces as big as possible. The tray holds pieces at full board size,
    // and is always deep enough to show a picked piece large.
    const gap = GAP;
    const margin = GAP;
    this.trayVertical = this.W >= this.H;
    const v = this.trayVertical;
    // Upright screens get a bar above the tray for "All pieces" and the hint,
    // so they never cover the large piece.
    this.bar = v ? 0 : CTL + GAP;
    // Landscape: a column on the left for the zoom buttons, so they never cover the board.
    const zoomCol = v ? GAP + CTL : 0;
    const minThick = v ? clamp(this.W * 0.25, 220, 380) : clamp(this.H * 0.36, 200, 420);
    const fitThick = (t: number) =>
      v
        ? Math.min((this.W - zoomCol - gap * 2 - margin * 2 - t) / this.cols, (this.H - margin * 2) / this.rows)
        : Math.min((this.W - margin * 2) / this.cols, (this.H - gap * 2 - margin * 2 - this.bar - t) / this.rows);
    const fit = (lanes: number) => {
      const s = v
        ? Math.min((this.W - zoomCol - gap * 2 - margin * 2) / (this.cols + lanes * SLOT), (this.H - margin * 2) / this.rows)
        : Math.min((this.W - margin * 2) / this.cols, (this.H - gap * 2 - margin * 2 - this.bar) / (this.rows + lanes * SLOT));
      return lanes * SLOT * s >= minThick ? s : Math.min(s, fitThick(minThick));
    };
    // More lanes when they cost nothing (the board is limited the other way)
    // or when pieces stay comfortably large anyway.
    const best = fit(1);
    let lanes = 1;
    for (let l = 2; l <= 4; l++) {
      const sl = fit(l);
      if (sl >= best - 0.5 || sl >= COMFORT_PX) lanes = l;
    }
    this.scale = fit(lanes);
    this.trayScale = this.scale; // the tray never zooms
    let thick = Math.max(minThick, lanes * SLOT * this.scale);
    // Upright: empty space under a width-limited board goes to the tray instead.
    if (!v) thick = Math.max(thick, this.H - gap - this.bar - (this.rows * this.scale + margin * 2));
    // Upright screens: the page arrows sit in the strip above the tray, so pieces get its full width.
    this.arrowsInBar = !v;
    // A deep tray with small pieces fits extra lanes.
    this.trayCross = clamp(Math.floor(thick / (SLOT * this.scale)), lanes, 6);

    const ARROW_ZONE = this.arrowsInBar ? 0 : CTL + INSET * 2;
    let region: Rect;
    if (v) {
      this.trayRect = { x: this.W - thick - gap, y: gap, w: thick, h: this.H - gap * 2 };
      this.trayList = { x: this.trayRect.x + INSET, y: this.trayRect.y + ARROW_ZONE, w: thick - INSET * 2, h: this.trayRect.h - ARROW_ZONE * 2 };
      region = { x: zoomCol, y: 0, w: this.trayRect.x - zoomCol, h: this.H };
    } else {
      this.trayRect = { x: gap, y: this.H - thick - gap, w: this.W - gap * 2, h: thick };
      this.trayList = { x: this.trayRect.x + INSET, y: this.trayRect.y + INSET, w: this.trayRect.w - INSET * 2, h: thick - INSET * 2 };
      region = { x: 0, y: 0, w: this.W, h: this.trayRect.y - this.bar };
    }
    this.ox = region.x + (region.w - this.cols * this.scale) / 2;
    this.oy = region.y + (region.h - this.rows * this.scale) / 2;
    this.region = region;
    this.base = { scale: this.scale, ox: this.ox, oy: this.oy };
    this.zoom = 1;
    this.placeArrows();
    // Landscape: their own column left of the board. Upright: the strip above
    // the tray, opposite "All pieces". Never on top of the picture.
    if (v) {
      Object.assign(this.zoomBox.style, { left: `${GAP}px`, top: `${region.y + GAP}px`, right: '' });
    } else {
      Object.assign(this.zoomBox.style, { left: '', top: `${this.trayRect.y - GAP - CTL}px`, right: `${this.W - this.trayRect.x - this.trayRect.w}px` });
    }
    this.zoomBox.classList.toggle('row', !v);
    Object.assign(this.toast.style, { left: `${region.x + region.w / 2}px`, bottom: `${this.H - region.y - region.h + 12}px` });
    this.syncZoomButtons();
    this.clampTrayScroll();

    // Keep table pieces on screen after a rotation.
    for (const i of this.table) this.clampToTable(this.pieces[i]);

    this.rerender(true);
    this.draw();
  }

  /**
   * Re-render piece bitmaps and the board layer for the current zoom. Resolution
   * is capped by the source image (more pixels would only blur) and by memory,
   * since iOS kills pages with too much canvas memory.
   */
  private rerender(force = false): void {
    const k = (this.crop.w / this.cols) * 1.25; // useful device px per unit
    const want = Math.min(this.scale * this.dpr, Math.max(this.base.scale * this.dpr, k));
    const memCap = Math.sqrt(64e6 / (4 * this.pieces.length)) / (1 + PAD * 2);
    const res = Math.min(want, memCap);
    const boardRes = Math.min(want, Math.sqrt(12e6 / (this.cols * this.rows)));
    const changed = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1) > 0.08;
    if (force || changed(res, this.res)) {
      this.res = res;
      for (const p of this.pieces) p.bitmap = this.renderPiece(p, true, res / this.dpr);
    }
    if (force || changed(boardRes, this.boardRes)) {
      this.boardRes = boardRes;
      this.renderBoardLayer();
    }
    this.requestDraw();
  }

  // ---------------------------------------------------------------- zoom

  private maxZoom(): number {
    return clamp(220 / this.base.scale, 2, 6);
  }

  /** Zoom so that screen point (px, py) keeps showing the same spot. */
  private setZoom(z: number, px: number, py: number): void {
    z = clamp(z, 1, this.maxZoom());
    const wx = (px - this.ox) / this.scale;
    const wy = (py - this.oy) / this.scale;
    this.zoom = z;
    this.scale = this.base.scale * z;
    this.ox = px - wx * this.scale;
    this.oy = py - wy * this.scale;
    this.clampPan();
    this.syncZoomButtons();
    this.requestDraw();
    clearTimeout(this.rerenderTimer);
    this.rerenderTimer = window.setTimeout(() => this.rerender(), 180);
  }

  private zoomBy(f: number): void {
    const r = this.region;
    this.setZoom(this.zoom * f, r.x + r.w / 2, r.y + r.h / 2);
  }

  private panBy(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
    this.clampPan();
    this.requestDraw();
  }

  /** Keep the board on screen: centred when it fits, edges not past the region when it doesn't. */
  private clampPan(): void {
    const r = this.region;
    const bw = this.cols * this.scale;
    const bh = this.rows * this.scale;
    const m = 16;
    this.ox = bw <= r.w - m * 2 ? r.x + (r.w - bw) / 2 : clamp(this.ox, r.x + r.w - m - bw, r.x + m);
    this.oy = bh <= r.h - m * 2 ? r.y + (r.h - bh) / 2 : clamp(this.oy, r.y + r.h - m - bh, r.y + m);
    if (this.zoom === 1) {
      this.ox = this.base.ox;
      this.oy = this.base.oy;
    }
  }

  private syncZoomButtons(): void {
    this.zoomOutBtn.disabled = this.zoom <= 1.001;
    this.zoomInBtn.disabled = this.zoom >= this.maxZoom() - 0.001;
  }

  /** Render one piece to its own canvas. `shadow` bakes a soft drop shadow in. */
  private renderPiece(p: Piece, shadow: boolean, cssScale = this.scale): HTMLCanvasElement {
    const s = cssScale * this.dpr;
    const size = Math.ceil((1 + PAD * 2) * s);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const ox = p.shape.col - PAD;
    const oy = p.shape.row - PAD;
    const path = new Path2D();
    traceOutline(path, p.shape.outline, ox, oy, s);

    if (shadow) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = Math.max(2, s * 0.05);
      g.shadowOffsetX = s * 0.015;
      g.shadowOffsetY = s * 0.03;
      g.fillStyle = '#777';
      g.fill(path);
      g.restore();
    }
    g.save();
    g.clip(path);
    this.drawSource(g, ox, oy, 1 + PAD * 2, 1 + PAD * 2, 0, 0, size, size);
    g.restore();
    strokePiece(g, path, s);
    return c;
  }

  /**
   * Draw the world-space rectangle (wx, wy, ww, wh) of the cropped image into
   * the destination rectangle. Clamps the source to the image, because Safari
   * draws nothing at all when the source rectangle goes outside it.
   */
  private drawSource(
    g: CanvasRenderingContext2D,
    wx: number,
    wy: number,
    ww: number,
    wh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const k = this.crop.w / this.cols; // image px per world unit
    let sx = this.crop.x + wx * k;
    let sy = this.crop.y + wy * k;
    let sw = ww * k;
    let sh = wh * k;
    const fx = dw / sw;
    const fy = dh / sh;
    const iw = this.img.naturalWidth;
    const ih = this.img.naturalHeight;
    if (sx < 0) { dx -= sx * fx; dw += sx * fx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy * fy; dh += sy * fy; sh += sy; sy = 0; }
    if (sx + sw > iw) { const over = sx + sw - iw; sw -= over; dw -= over * fx; }
    if (sy + sh > ih) { const over = sy + sh - ih; sh -= over; dh -= over * fy; }
    if (sw <= 0 || sh <= 0) return;
    g.drawImage(this.img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  private renderBoardLayer(): void {
    const s = this.boardRes;
    const w = Math.ceil(this.cols * s);
    const h = Math.ceil(this.rows * s);
    const c = this.boardLayer;
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, w, h);
    if (this.board === 'full') {
      g.globalAlpha = 0.4;
      this.drawSource(g, 0, 0, this.cols, this.rows, 0, 0, w, h);
      g.globalAlpha = 1;
    }
    // Faint outlines show where pieces go (not on a blank board).
    if (this.board !== 'blank') {
      g.strokeStyle = 'rgba(60,50,40,0.35)';
      g.lineWidth = Math.max(1.5, s * 0.014);
      for (const p of this.pieces) {
        const path = new Path2D();
        traceOutline(path, p.shape.outline, 0, 0, s);
        g.stroke(path);
      }
    }
    for (const p of this.pieces) if (p.state === 'placed' && !this.isAnimating(p)) this.stampPlaced(p);
  }

  private stampPlaced(p: Piece): void {
    const g = this.boardLayer.getContext('2d')!;
    const s = this.boardRes;
    const path = new Path2D();
    traceOutline(path, p.shape.outline, 0, 0, s);
    g.save();
    g.clip(path);
    const { col, row } = p.shape;
    // Draw a little beyond the cell so tabs are covered too.
    this.drawSource(g, col - PAD, row - PAD, 1 + PAD * 2, 1 + PAD * 2, (col - PAD) * s, (row - PAD) * s, (1 + PAD * 2) * s, (1 + PAD * 2) * s);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = Math.max(1, s * 0.006);
    g.stroke(path);
  }

  // ---------------------------------------------------------------- drawing

  private requestDraw(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    const dragging = new Set([...this.gestures.values()].flatMap((gs) => (gs.kind === 'drag' ? [gs.piece] : [])));
    const now = performance.now();
    g.save();
    g.beginPath();
    g.rect(this.region.x, this.region.y, this.region.w, this.region.h);
    g.clip();
    const animating = this.drawBoardAndTable(dragging, now);
    g.restore();

    this.drawTray(dragging);

    // Pieces being dragged go on top of everything: big enough to see, and over
    // the picture a faint copy shows where it would land.
    for (const gs of this.gestures.values()) {
      if (gs.kind !== 'drag') continue;
      const c = this.dragCentre(gs);
      if (this.cellAt(c.x, c.y)) this.drawGhost(c.x, c.y);
      const ds = this.dragScale();
      this.drawPieceAt(this.pieces[gs.piece], gs.px - gs.dx * ds, gs.py - gs.dy * ds, ds);
    }

    if (this.trayVelocity !== 0) this.stepInertia();
    if (this.trayTarget !== null) {
      this.trayScroll += (this.trayTarget - this.trayScroll) * 0.25;
      if (Math.abs(this.trayTarget - this.trayScroll) < 0.5) {
        this.trayScroll = this.trayTarget;
        this.trayTarget = null;
      }
    }
    if (this.swipeTarget !== null) {
      this.swipeOffset += (this.swipeTarget - this.swipeOffset) * 0.3;
      if (Math.abs(this.swipeTarget - this.swipeOffset) < 1) this.finishSwipe();
    }
    if (animating || this.trayVelocity !== 0 || this.trayTarget !== null || this.swipeTarget !== null) this.requestDraw();
  }

  /** Board, placed pieces, snap animations, loose pieces and flashes. Returns true while animating. */
  private drawBoardAndTable(dragging: Set<number>, now: number): boolean {
    const g = this.ctx;
    // Board
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.25)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 4;
    g.fillStyle = '#fff';
    g.fillRect(this.ox, this.oy, this.cols * this.scale, this.rows * this.scale);
    g.restore();
    g.drawImage(this.boardLayer, this.ox, this.oy, this.cols * this.scale, this.rows * this.scale);
    if (this.preview) {
      this.drawSource(g, 0, 0, this.cols, this.rows, this.ox, this.oy, this.cols * this.scale, this.rows * this.scale);
    }

    // Snap animations, sliding into place
    let animating = false;
    for (const a of [...this.anims]) {
      const p = this.pieces[a.piece];
      const t = Math.min(1, (now - a.t0) / SNAP_MS);
      const e = 1 - (1 - t) * (1 - t);
      const x = a.fromX + (p.shape.col - a.fromX) * e;
      const y = a.fromY + (p.shape.row - a.fromY) * e;
      if (t >= 1) {
        this.anims = this.anims.filter((b) => b !== a);
        this.stampPlaced(p);
        if (!this.preview) g.drawImage(this.boardLayer, this.ox, this.oy, this.cols * this.scale, this.rows * this.scale);
      } else {
        animating = true;
        this.drawPieceAt(p, this.ox + x * this.scale, this.oy + y * this.scale, this.scale);
      }
    }

    // Loose pieces on the table
    for (const i of this.table) {
      if (dragging.has(i)) continue;
      const p = this.pieces[i];
      this.drawPieceAt(p, this.ox + p.x * this.scale, this.oy + p.y * this.scale, this.scale);
    }

    if (this.focus !== null && this.pieces[this.focus].state === 'table' && !dragging.has(this.focus)) {
      const p = this.pieces[this.focus];
      this.strokeSelection(this.focus, this.ox + p.x * this.scale, this.oy + p.y * this.scale, this.scale);
    }
    animating = this.drawFlashes(now) || animating;
    return animating;
  }

  private drawFlashes(now: number): boolean {
    const g = this.ctx;
    this.flashes = this.flashes.filter((f) => now - f.t0 < (f.kind === 'miss' ? MISS_MS : HINT_MS));
    for (const f of this.flashes) {
      const t = (now - f.t0) / (f.kind === 'miss' ? MISS_MS : HINT_MS);
      const path = this.screenPath(f.col, f.row);
      g.save();
      g.lineJoin = 'round';
      if (f.kind === 'miss') {
        g.globalAlpha = 1 - t;
        g.strokeStyle = '#d94f3d';
        g.lineWidth = Math.max(4, this.scale * 0.06);
      } else {
        g.globalAlpha = 0.55 + 0.45 * Math.sin(t * Math.PI * 6);
        g.strokeStyle = '#ffd34d';
        g.lineWidth = Math.max(5, this.scale * 0.08);
      }
      g.stroke(path);
      g.restore();
    }
    return this.flashes.length > 0;
  }

  /** Outline of grid cell (col, row) in screen coordinates. */
  private screenPath(col: number, row: number): Path2D {
    const path = new Path2D();
    const shape = this.pieces[row * this.cols + col].shape;
    traceOutline(path, shape.outline, -this.ox / this.scale, -this.oy / this.scale, this.scale);
    return path;
  }

  /** The cell under a screen point, or null when outside the board. */
  private cellAt(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.ox) / this.scale);
    const row = Math.floor((y - this.oy) / this.scale);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return { col, row };
  }

  /** While dragging over the board: the piece shown faintly where it would land, outlined. */
  private drawGhost(x: number, y: number): void {
    const g = this.ctx;
    const cell = this.cellAt(x, y);
    // Not on a blank board, where it would give the grid away.
    if (!cell || this.board === 'blank') return;
    if (this.focus !== null) {
      g.save();
      g.globalAlpha = 0.85;
      this.drawPieceAt(this.pieces[this.focus], this.ox + cell.col * this.scale, this.oy + cell.row * this.scale, this.scale);
      g.restore();
    }
    g.save();
    g.strokeStyle = '#fff';
    g.lineWidth = Math.max(3, this.scale * 0.04);
    g.stroke(this.screenPath(cell.col, cell.row));
    g.restore();
  }

  /** Draw a piece whose cell top-left lands on screen point (x, y) at `scale` px/unit. */
  private drawPieceAt(p: Piece, x: number, y: number, scale: number): void {
    if (!p.bitmap) return;
    const size = (1 + PAD * 2) * scale;
    this.ctx.drawImage(p.bitmap, x - PAD * scale, y - PAD * scale, size, size);
  }

  private drawTray(dragging: Set<number>): void {
    const g = this.ctx;
    const r = this.trayRect;
    if (this.tray.length === 0 && this.placedCount === this.total) return;
    g.save();
    roundRect(g, r, 22);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fill();
    const L = this.trayList;
    g.beginPath();
    g.rect(L.x, L.y, L.w, L.h);
    g.clip();
    if (this.trayMode === 'big') {
      const { cells, scale, area, length } = this.bigLayout();
      const n = cells.length;
      if (Math.abs(scale - this.bigBitmapScale) > 0.5) {
        this.bigBitmaps.clear();
        this.bigBitmapScale = scale;
      }
      const size = (1 + PAD * 2) * scale;
      if (this.pageStart >= this.tray.length) this.pageStart = Math.max(0, Math.floor((this.tray.length - 1) / n) * n);
      // While sliding, the neighbouring pages show at the edges.
      const sliding = this.swipeOffset !== 0 && this.pageCount(n) > 1;
      const pagesToDraw = sliding ? [-1, 0, 1] : [0];
      // Keep only the visible pages' large bitmaps; iOS is strict about canvas memory.
      if (this.bigBitmaps.size > n * 4) {
        const keep = new Set([-1, 0, 1].flatMap((k) => this.tray.slice(this.pageStartAt(k, n), this.pageStartAt(k, n) + n)));
        for (const key of [...this.bigBitmaps.keys()]) if (!keep.has(key)) this.bigBitmaps.delete(key);
      }
      g.beginPath();
      g.rect(area.x, area.y, area.w, area.h);
      g.clip();
      for (const k of pagesToDraw) {
        const start = k === 0 ? this.pageStart : this.pageStartAt(k, n);
        const shift = this.swipeOffset + k * length;
        cells.forEach((c, j) => {
          const i = this.tray[start + j];
          if (i === undefined || dragging.has(i)) return;
          let bmp = this.bigBitmaps.get(i);
          if (!bmp) {
            bmp = this.renderPiece(this.pieces[i], true, scale);
            this.bigBitmaps.set(i, bmp);
          }
          const cx = c.cx + (this.trayVertical ? 0 : shift);
          const cy = c.cy + (this.trayVertical ? shift : 0);
          g.drawImage(bmp, cx - size / 2, cy - size / 2, size, size);
          if (k === 0 && i === this.focus) this.strokeSelection(i, cx - scale / 2, cy - scale / 2, scale);
        });
      }
      g.restore();
      this.syncArrows();
      return;
    }
    for (let k = 0; k < this.tray.length; k++) {
      const i = this.tray[k];
      if (dragging.has(i)) continue;
      const c = this.slotCenter(k);
      if (!this.slotVisible(c)) continue;
      const half = this.trayScale / 2;
      this.drawPieceAt(this.pieces[i], c.x - half, c.y - half, this.trayScale);
    }
    g.restore();
    this.syncArrows();
  }

  /**
   * How the page of large pieces is laid out: as many pieces as fit while each
   * stays clearly bigger than on the board (or the biggest single piece if
   * nothing fits that). Usually 2×2 on a phone, a column of 2–3 on an iPad.
   */
  private bigLayout(): {
    scale: number;
    cells: { cx: number; cy: number; w: number; h: number }[];
    area: Rect;
    length: number;
  } {
    const L = this.trayList;
    const top = this.gridAllowed() && !this.bar ? CTL + INSET : 0; // the mode button sits at the top of a side tray
    const area = { x: L.x, y: L.y + top, w: L.w, h: L.h - top };
    const slot = 1.6; // piece plus room for tabs, in piece widths
    const target = clamp(this.base.scale * 1.05, 80, 140); // at least board size, and never tiny
    const options = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 3], [2, 2], [1, 4], [4, 1], [3, 2], [2, 3], [2, 4], [4, 2], [3, 3]];
    let best: { c: number; r: number; scale: number } | null = null;
    let biggest = { c: 1, r: 1, scale: 0 };
    for (const [c, r] of options) {
      const scale = Math.min(area.w / c, area.h / r) / slot;
      if (scale > biggest.scale) biggest = { c, r, scale };
      const n = c * r;
      if (scale >= target && (!best || n > best.c * best.r || (n === best.c * best.r && scale > best.scale))) best = { c, r, scale };
    }
    const b = best ?? biggest;
    const w = area.w / b.c;
    const h = area.h / b.r;
    const cells = [];
    for (let r = 0; r < b.r; r++) for (let c = 0; c < b.c; c++) cells.push({ cx: area.x + (c + 0.5) * w, cy: area.y + (r + 0.5) * h, w, h });
    return { scale: b.scale, cells, area, length: this.trayVertical ? area.h : area.w };
  }

  private pageCount(n: number): number {
    return Math.max(1, Math.ceil(this.tray.length / n));
  }

  /** First tray index of the page `k` steps from the current one. Wraps around: the tray is endless. */
  private pageStartAt(k: number, n: number): number {
    const pages = this.pageCount(n);
    const idx = Math.floor(this.pageStart / n);
    return ((((idx + k) % pages) + pages) % pages) * n;
  }

  private setSwipe(offset: number): void {
    const n = this.bigLayout().cells.length;
    this.swipeOffset = this.pageCount(n) > 1 ? offset : offset * 0.25;
    this.requestDraw();
  }

  /** Jump to the end of a running page animation (used before starting another, or on touch). */
  private finishSwipe(): void {
    if (this.swipeTarget !== null && this.swipeTarget !== 0) {
      const n = this.bigLayout().cells.length;
      this.pageStart = this.pageStartAt(this.swipeTarget < 0 ? 1 : -1, n);
      this.focus = this.tray[this.pageStart] ?? null;
      this.misses = 0;
    }
    this.swipeTarget = null;
    this.swipeOffset = 0;
  }

  /** Which piece on the big page is under a screen point. */
  private bigHit(x: number, y: number): number | null {
    if (this.swipeOffset !== 0) return null;
    const { cells } = this.bigLayout();
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (Math.abs(x - c.cx) <= c.w / 2 && Math.abs(y - c.cy) <= c.h / 2) return this.tray[this.pageStart + k] ?? null;
    }
    return null;
  }

  /** Thick outline around the selected piece, whose cell top-left is at screen (x, y). */
  private strokeSelection(i: number, x: number, y: number, scale: number): void {
    const g = this.ctx;
    const shape = this.pieces[i].shape;
    const path = new Path2D();
    traceOutline(path, shape.outline, shape.col - x / scale, shape.row - y / scale, scale);
    // Outline drawn only outside the piece, so it never covers the picture on it.
    const outside = new Path2D();
    outside.rect(0, 0, this.W, this.H);
    outside.addPath(path);
    g.save();
    g.clip(outside, 'evenodd');
    g.lineJoin = 'round';
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 8; // half of it is clipped away: 4 px visible
    g.shadowColor = 'rgba(0,0,0,0.3)';
    g.shadowBlur = 4;
    g.stroke(path);
    g.restore();
  }

  /** The small-pieces view is offered where there's room for it (not on phones). */
  private gridAllowed(): boolean {
    return this.W >= 600;
  }

  private setMode(mode: 'big' | 'grid'): void {
    this.trayMode = mode;
    if (mode === 'big') {
      const n = this.bigLayout().cells.length;
      const k = this.focus !== null ? this.tray.indexOf(this.focus) : -1;
      this.pageStart = k >= 0 ? Math.floor(k / n) * n : 0;
      if (k < 0) this.focus = this.tray[this.pageStart] ?? null;
    }
    this.clampTrayScroll();
    this.requestDraw();
  }

  private setFocus(piece: number | null): void {
    if (piece !== this.focus) this.misses = 0;
    this.focus = piece;
    if (piece !== null) {
      localStorage.setItem(LEARNED_KEY, '1');
      playPickup();
    }
    this.requestDraw();
  }

  /** After placing the selected piece, select the next one on the same page so she can carry on. */
  private advanceFocus(fromIndex: number): void {
    this.misses = 0;
    if (this.tray.length === 0) {
      this.focus = null;
      return;
    }
    if (this.trayMode === 'big') {
      const n = this.bigLayout().cells.length;
      if (this.pageStart >= this.tray.length) this.pageStart = Math.floor((this.tray.length - 1) / n) * n;
      const end = Math.min(this.tray.length, this.pageStart + n) - 1;
      this.focus = this.tray[clamp(fromIndex, this.pageStart, end)];
      return;
    }
    this.focus = this.tray[Math.min(Math.max(fromIndex, 0), this.tray.length - 1)];
  }

  private placeArrows(): void {
    const r = this.trayRect;
    const L = this.trayList;
    this.arrowPrev.classList.toggle('strip', !this.arrowsInBar);
    this.arrowNext.classList.toggle('strip', !this.arrowsInBar);
    if (this.arrowsInBar) {
      // Upright: a row above the tray: [<] [>] [All pieces] ........ [+] [-]
      const top = r.y - GAP - CTL;
      Object.assign(this.arrowPrev.style, { left: `${r.x}px`, top: `${top}px`, width: `${CTL}px`, height: `${CTL}px` });
      Object.assign(this.arrowNext.style, { left: `${r.x + CTL + GAP}px`, top: `${top}px`, width: `${CTL}px`, height: `${CTL}px` });
      this.arrowPrev.dataset.dir = 'left';
      this.arrowNext.dataset.dir = 'right';
      Object.assign(this.allButton.style, { left: `${r.x + (CTL + GAP) * 2}px`, top: `${top}px`, maxWidth: '' });
    } else {
      // Landscape: full-width strips at both ends of the tray, mode button at the top of the list.
      const w = r.w - INSET * 2;
      Object.assign(this.arrowPrev.style, { left: `${r.x + INSET}px`, top: `${r.y + INSET}px`, width: `${w}px`, height: `${CTL}px` });
      Object.assign(this.arrowNext.style, { left: `${r.x + INSET}px`, top: `${r.y + r.h - INSET - CTL}px`, width: `${w}px`, height: `${CTL}px` });
      this.arrowPrev.dataset.dir = 'up';
      this.arrowNext.dataset.dir = 'down';
      Object.assign(this.allButton.style, { left: `${L.x}px`, top: `${L.y}px`, maxWidth: `${L.w}px` });
    }
  }

  private syncArrows(): void {
    const hidden = this.tray.length === 0 && this.placedCount === this.total;
    this.arrowPrev.hidden = hidden;
    this.arrowNext.hidden = hidden;
    this.allButton.hidden = hidden || !this.gridAllowed();
    this.allButton.querySelector('span')!.textContent = this.trayMode === 'big' ? this.opts.labels.all : this.opts.labels.big;
    if (this.trayMode === 'big') {
      const many = this.tray.length > this.bigLayout().cells.length;
      this.arrowPrev.disabled = !many;
      this.arrowNext.disabled = !many;
      return;
    }
    const max = this.maxTrayScroll();
    const pos = this.trayTarget ?? this.trayScroll;
    this.arrowPrev.disabled = pos <= 1;
    this.arrowNext.disabled = pos >= max - 1;
  }

  // ---------------------------------------------------------------- tray geometry

  private slotSize(): number {
    const cross = this.trayVertical ? this.trayList.w : this.trayList.h;
    return cross / this.trayCross;
  }

  private slotCenter(k: number): { x: number; y: number } {
    const slot = this.slotSize();
    const across = k % this.trayCross;
    const along = Math.floor(k / this.trayCross);
    const r = this.trayList;
    const a = slot * (along + 0.5) - this.trayScroll;
    const b = slot * (across + 0.5);
    return this.trayVertical ? { x: r.x + b, y: r.y + a } : { x: r.x + a, y: r.y + b };
  }

  private slotVisible(c: { x: number; y: number }): boolean {
    const r = this.trayList;
    const m = this.slotSize();
    return c.x > r.x - m && c.x < r.x + r.w + m && c.y > r.y - m && c.y < r.y + r.h + m;
  }

  /** Index of the tray slot under a screen point, which may be past the end. */
  private slotAt(x: number, y: number): number {
    const r = this.trayList;
    const slot = this.slotSize();
    const a = (this.trayVertical ? y - r.y : x - r.x) + this.trayScroll;
    const b = this.trayVertical ? x - r.x : y - r.y;
    const along = Math.max(0, Math.floor(a / slot));
    const across = clamp(Math.floor(b / slot), 0, this.trayCross - 1);
    return along * this.trayCross + across;
  }

  private maxTrayScroll(): number {
    const lines = Math.ceil(this.tray.length / this.trayCross);
    const length = this.trayVertical ? this.trayList.h : this.trayList.w;
    return Math.max(0, lines * this.slotSize() - length);
  }

  private clampTrayScroll(): void {
    this.trayScroll = clamp(this.trayScroll, 0, this.maxTrayScroll());
  }

  private stepInertia(): void {
    this.trayScroll += this.trayVelocity * 16;
    this.trayVelocity *= 0.94;
    const max = this.maxTrayScroll();
    if (this.trayScroll <= 0 || this.trayScroll >= max || Math.abs(this.trayVelocity) < 0.02) {
      this.trayVelocity = 0;
    }
    this.clampTrayScroll();
  }

  // ---------------------------------------------------------------- input

  private inTray(x: number, y: number): boolean {
    const r = this.trayRect;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private tableHit(x: number, y: number): number | null {
    const wx = (x - this.ox) / this.scale;
    const wy = (y - this.oy) / this.scale;
    const m = 0.18; // grab a little outside the cell too
    for (let k = this.table.length - 1; k >= 0; k--) {
      const p = this.pieces[this.table[k]];
      if (wx >= p.x - m && wx <= p.x + 1 + m && wy >= p.y - m && wy <= p.y + 1 + m) return this.table[k];
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    unlockAudio();
    this.hideToast();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; the gesture still works without capture.
    }
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, { x, y });

    // A second finger on the board turns whatever the first was doing into a pinch.
    if (!this.inTray(x, y) && this.gestures.size === 1 && !this.pinch) {
      const [otherId, other] = [...this.gestures.entries()][0];
      const pinchable =
        (other.kind === 'pending' && (other.origin === 'board' || other.origin === 'table')) || other.kind === 'pan';
      const op = this.pointers.get(otherId);
      if (pinchable && op) {
        if (other.kind === 'pending') clearTimeout(other.timer);
        const mx = (x + op.x) / 2;
        const my = (y + op.y) / 2;
        this.pinch = {
          a: otherId,
          b: e.pointerId,
          startDist: Math.max(20, Math.hypot(x - op.x, y - op.y)),
          startZoom: this.zoom,
          wx: (mx - this.ox) / this.scale,
          wy: (my - this.oy) / this.scale,
        };
        this.gestures.set(otherId, { kind: 'idle', id: otherId });
        this.gestures.set(e.pointerId, { kind: 'idle', id: e.pointerId });
        this.requestDraw();
        return;
      }
    }

    const pending = (origin: Origin, piece: number | null, timer = 0) =>
      this.gestures.set(e.pointerId, { kind: 'pending', id: e.pointerId, startX: x, startY: y, piece, origin, timer });

    if (this.inTray(x, y)) {
      this.trayVelocity = 0;
      this.trayTarget = null;
      if (this.trayMode === 'big') {
        this.finishSwipe();
        pending('big', this.bigHit(x, y));
      } else {
        const k = this.slotAt(x, y);
        pending('tray', k < this.tray.length ? this.tray[k] : null);
      }
      return;
    }
    const hit = this.tableHit(x, y);
    if (hit !== null) {
      pending('table', hit);
      return;
    }
    // Empty board or table: a tap places the selected piece.
    pending('board', null);
  };

  private onMove = (e: PointerEvent): void => {
    const gs = this.gestures.get(e.pointerId);
    if (!gs) return;
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    const pinch = this.pinch;
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
      const pa = this.pointers.get(pinch.a);
      const pb = this.pointers.get(pinch.b);
      if (!pa || !pb) return;
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const z = clamp((pinch.startZoom * Math.hypot(pa.x - pb.x, pa.y - pb.y)) / pinch.startDist, 1, this.maxZoom());
      // Zoom, then move so the pinched spot follows the fingers.
      this.zoom = z;
      this.scale = this.base.scale * z;
      this.ox = mx - pinch.wx * this.scale;
      this.oy = my - pinch.wy * this.scale;
      this.clampPan();
      this.syncZoomButtons();
      this.requestDraw();
      return;
    }
    if (gs.kind === 'idle') return;
    if (gs.kind === 'swipe') {
      const pos = this.trayVertical ? y : x;
      const now = performance.now();
      gs.velocity = 0.7 * gs.velocity + 0.3 * ((pos - gs.last) / Math.max(1, now - gs.lastT));
      gs.last = pos;
      gs.lastT = now;
      this.setSwipe(pos - gs.start);
      return;
    }
    if (gs.kind === 'pan') {
      this.panBy(x - gs.x, y - gs.y);
      gs.x = x;
      gs.y = y;
      return;
    }
    if (gs.kind === 'pending') {
      const mx = x - gs.startX;
      const my = y - gs.startY;
      if (Math.hypot(mx, my) < 10) return;
      clearTimeout(gs.timer);
      if (gs.origin === 'board') {
        // Zoomed in: dragging moves the picture. Otherwise a moved finger is not a tap.
        if (this.zoom > 1.001) {
          this.gestures.set(e.pointerId, { kind: 'pan', id: e.pointerId, x, y });
          this.panBy(x - gs.startX, y - gs.startY);
        } else {
          this.gestures.set(e.pointerId, { kind: 'idle', id: e.pointerId });
        }
        return;
      }
      if (gs.origin === 'table' && gs.piece !== null) {
        const p = this.pieces[gs.piece];
        const dx = (gs.startX - this.ox) / this.scale - p.x;
        const dy = (gs.startY - this.oy) / this.scale - p.y;
        this.table = this.table.filter((i) => i !== gs.piece);
        this.table.push(gs.piece);
        this.startDrag(e.pointerId, gs.piece, dx, dy, x, y);
        return;
      }
      if (gs.origin === 'big') {
        // Along the tray swipes to another page; across it pulls the piece out toward the board.
        const alongBig = Math.abs(this.trayVertical ? my : mx);
        const acrossBig = Math.abs(this.trayVertical ? mx : my);
        if (gs.piece === null || acrossBig < alongBig * 0.5) {
          const pos = this.trayVertical ? y : x;
          const start = this.trayVertical ? gs.startY : gs.startX;
          this.gestures.set(e.pointerId, { kind: 'swipe', id: e.pointerId, start, last: pos, lastT: performance.now(), velocity: 0 });
          this.swipeTarget = null;
          this.setSwipe(pos - start);
          return;
        }
        this.liftFromTray(e.pointerId, gs.piece, x, y);
        return;
      }
      // In the tray, moving along the tray scrolls; moving across it pulls a piece out.
      const along = Math.abs(this.trayVertical ? my : mx);
      const across = Math.abs(this.trayVertical ? mx : my);
      if (gs.piece !== null && across > along * 0.5) {
        this.liftFromTray(e.pointerId, gs.piece, x, y);
      } else {
        const pos = this.trayVertical ? y : x;
        this.trayScroll -= pos - (this.trayVertical ? gs.startY : gs.startX);
        this.clampTrayScroll();
        this.gestures.set(e.pointerId, { kind: 'scroll', id: e.pointerId, last: pos, lastT: performance.now(), velocity: 0 });
        this.requestDraw();
      }
      return;
    }
    if (gs.kind === 'scroll') {
      const pos = this.trayVertical ? y : x;
      const now = performance.now();
      const delta = pos - gs.last;
      this.trayScroll -= delta;
      this.clampTrayScroll();
      const dt = Math.max(1, now - gs.lastT);
      gs.velocity = 0.7 * gs.velocity + 0.3 * (-delta / dt);
      gs.last = pos;
      gs.lastT = now;
      this.requestDraw();
      return;
    }
    gs.px = x;
    gs.py = y;
    this.requestDraw();
  };

  private onUp = (e: PointerEvent): void => {
    const gs = this.gestures.get(e.pointerId);
    this.gestures.delete(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch && (e.pointerId === this.pinch.a || e.pointerId === this.pinch.b)) {
      this.pinch = null;
      clearTimeout(this.rerenderTimer);
      this.rerenderTimer = window.setTimeout(() => this.rerender(), 60);
      return;
    }
    if (gs?.kind === 'swipe') {
      const { cells, length } = this.bigLayout();
      const fling = Math.abs(gs.velocity) > 0.5 && performance.now() - gs.lastT < 100;
      const far = Math.abs(this.swipeOffset) > length * 0.2;
      const turn = this.pageCount(cells.length) > 1 && (far || fling) && e.type !== 'pointercancel';
      const dir = fling ? Math.sign(gs.velocity) : Math.sign(this.swipeOffset);
      this.swipeTarget = turn && dir !== 0 ? dir * length : 0;
      if (turn) playPickup();
      this.requestDraw();
      return;
    }
    if (!gs || gs.kind === 'idle' || gs.kind === 'pan') return;
    const cancelled = e.type === 'pointercancel';
    if (gs.kind === 'pending') {
      clearTimeout(gs.timer);
      if (cancelled) return;
      // A tap.
      if (gs.origin === 'tray' && gs.piece !== null) {
        // From the small grid: open the big page that holds this piece.
        this.focus = gs.piece;
        this.setMode('big');
        this.setFocus(gs.piece);
      } else if ((gs.origin === 'big' || gs.origin === 'table') && gs.piece !== null) this.setFocus(gs.piece);
      else if (gs.origin === 'board' && this.focus !== null) this.tryPlace(this.focus, this.cellAt(gs.startX, gs.startY));
      return;
    }
    if (gs.kind === 'scroll') {
      if (performance.now() - gs.lastT < 80) this.trayVelocity = gs.velocity;
      this.requestDraw();
      return;
    }
    this.drop(gs);
  };

  /** Put a piece on a cell chosen by tapping. Only the right cell takes it. */
  private tryPlace(i: number, cell: { col: number; row: number } | null): void {
    if (!cell) return;
    const p = this.pieces[i];
    if (cell.col === p.shape.col && cell.row === p.shape.row) {
      this.learnedPlacing();
      const k = this.tray.indexOf(i);
      this.place(i, p.shape.col, p.shape.row - 0.12);
      if (this.focus === i) this.advanceFocus(k);
      this.requestDraw();
      return;
    }
    this.misses++;
    const now = performance.now();
    this.flashes.push({ ...cell, kind: 'miss', t0: now });
    if (this.misses >= MISSES_BEFORE_HINT) {
      this.flashes.push({ col: p.shape.col, row: p.shape.row, kind: 'hint', t0: now });
      this.misses = 0;
    }
    playMiss();
    this.requestDraw();
  }

  private place(i: number, fromX: number, fromY: number): void {
    const p = this.pieces[i];
    this.tray = this.tray.filter((j) => j !== i);
    this.table = this.table.filter((j) => j !== i);
    p.state = 'placed';
    this.anims.push({ piece: i, fromX, fromY, t0: performance.now() });
    playSnap();
    this.reportProgress();
    this.clampTrayScroll();
    this.opts.onChange();
    if (this.placedCount === this.total) setTimeout(() => !this.destroyed && this.opts.onComplete(), SNAP_MS + 450);
  }

  private dragScale(): number {
    return Math.max(this.scale * 1.04, DRAG_MIN_PX);
  }

  /** Screen position of the centre of a dragged piece. */
  private dragCentre(gs: Extract<Gesture, { kind: 'drag' }>): { x: number; y: number } {
    const ds = this.dragScale();
    return { x: gs.px + (0.5 - gs.dx) * ds, y: gs.py + (0.5 - gs.dy) * ds };
  }

  /** Pieces pulled out of the tray hang just above the finger, centred. */
  private liftFromTray(id: number, piece: number, px: number, py: number): void {
    const ds = this.dragScale();
    this.startDrag(id, piece, 0.5, 1 + DRAG_LIFT_PX / ds, px, py);
  }

  private startDrag(id: number, piece: number, dx: number, dy: number, px: number, py: number): void {
    if (this.focus !== piece) this.misses = 0;
    this.focus = piece; // the piece in her hand is the selected one
    this.gestures.set(id, { kind: 'drag', id, piece, dx, dy, px, py });
    playPickup();
    this.requestDraw();
  }

  private drop(gs: Extract<Gesture, { kind: 'drag' }>): void {
    const p = this.pieces[gs.piece];
    const i = gs.piece;
    const { x: centreX, y: centreY } = this.dragCentre(gs);
    const wx = (centreX - this.ox) / this.scale - 0.5;
    const wy = (centreY - this.oy) / this.scale - 0.5;
    // Anywhere inside its own spot places it. Anywhere else it's simply laid
    // down there, like on a real table, so she can try pieces out.
    const cell = this.cellAt(centreX, centreY);
    if (cell && cell.col === p.shape.col && cell.row === p.shape.row) {
      const k = this.tray.indexOf(i);
      this.place(i, wx, wy);
      if (this.focus === i) this.advanceFocus(k);
      this.requestDraw();
      return;
    }
    this.tray = this.tray.filter((j) => j !== i);
    this.table = this.table.filter((j) => j !== i);
    if (this.inTray(centreX, centreY)) {
      p.state = 'tray';
      const k = Math.min(this.slotAt(centreX, centreY), this.tray.length);
      this.tray.splice(k, 0, i);
    } else {
      p.state = 'table';
      p.x = wx;
      p.y = wy;
      this.clampToTable(p);
      this.table.push(i);
    }
    this.clampTrayScroll();
    this.requestDraw();
    this.opts.onChange();
  }

  private clampToTable(p: Piece): void {
    // Keep at least most of the piece visible, outside the tray.
    let right = this.W;
    let bottom = this.H;
    if (this.trayVertical) right = this.trayRect.x;
    else bottom = this.trayRect.y;
    const m = TAB_REACH; // keep tabs on screen too
    const minX = (0 - this.ox) / this.scale + m;
    const minY = (0 - this.oy) / this.scale + m;
    const maxX = (right - this.ox) / this.scale - 1 - m;
    const maxY = (bottom - this.oy) / this.scale - 1 - m;
    p.x = clamp(p.x, minX, maxX);
    p.y = clamp(p.y, minY, maxY);
  }

  private isAnimating(p: Piece): boolean {
    return this.anims.some((a) => this.pieces[a.piece] === p);
  }

  private reportProgress(): void {
    this.opts.onProgress(this.placedCount, this.total);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}

// ------------------------------------------------------------------ helpers

function cropFor(img: HTMLImageElement, aspect: number): Rect {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw / ih > aspect) {
    const w = ih * aspect;
    return { x: (iw - w) / 2, y: 0, w, h: ih };
  }
  const h = iw / aspect;
  return { x: 0, y: (ih - h) / 2, w: iw, h };
}

function strokePiece(g: CanvasRenderingContext2D, path: Path2D, s: number): void {
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = Math.max(1, s * 0.02);
  g.stroke(path);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = Math.max(1, s * 0.008);
  g.stroke(path);
}

function zoomButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'zoom-btn ctl';
  // Drawn, not typed: text glyphs sit off-centre in a round button.
  const d = text === '+' ? 'M12 5v14M5 12h14' : 'M5 12h14';
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function arrowButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'tray-arrow ctl';
  b.setAttribute('aria-label', label);
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  b.addEventListener('click', onClick);
  return b;
}

function roundRect(g: CanvasRenderingContext2D, r: Rect, radius: number): void {
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, radius);
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
