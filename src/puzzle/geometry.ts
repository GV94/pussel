// Puzzle geometry in "world units": one grid cell is 1×1, the board spans
// [0, cols] × [0, rows]. Everything here is pure so it can be unit-tested.

export type Pt = { x: number; y: number };
/** A cubic Bézier segment: start, control 1, control 2, end. */
export type Seg = [Pt, Pt, Pt, Pt];

/** How far a tab can stick out of its cell, in cell units. Used for bitmap padding. */
export const TAB_REACH = 0.3;

export type Grid = { cols: number; rows: number };

/**
 * Pick cols × rows close to `target` pieces, with cells as square as possible
 * for an image of the given aspect ratio (width / height).
 */
export function chooseGrid(target: number, aspect: number): Grid {
  let best: Grid = { cols: 1, rows: 1 };
  let bestScore = Infinity;
  for (let cols = 2; cols <= 40; cols++) {
    for (let rows = 2; rows <= 40; rows++) {
      const cellAspect = aspect * (rows / cols); // cell width / cell height
      const squareness = Math.abs(Math.log(cellAspect));
      const countError = Math.abs(cols * rows - target) / target;
      const score = countError * 3 + squareness;
      if (score < bestScore) {
        bestScore = score;
        best = { cols, rows };
      }
    }
  }
  return best;
}

/** Small deterministic PRNG so a saved puzzle regenerates identical shapes. */
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

/**
 * Tab profile for an edge from (0,0) to (1,0). Negative y bulges "up", which the
 * caller maps onto one side of the edge. `shift` moves the tab along the edge,
 * `size` scales it.
 */
function tabProfile(shift: number, size: number): Seg[] {
  const c = 0.5 + shift;
  const k = size;
  const P = (x: number, y: number): Pt => ({ x: c + (x - 0.5) * k, y: y * k });
  const start: Pt = { x: 0, y: 0 };
  const a = P(0.38, 0);
  const end: Pt = { x: 1, y: 0 };
  const b = P(0.62, 0);
  return [
    line(start, a),
    [a, P(0.45, 0), P(0.46, -0.04), P(0.44, -0.08)],
    [P(0.44, -0.08), P(0.36, -0.14), P(0.37, -0.25), P(0.5, -0.25)],
    [P(0.5, -0.25), P(0.63, -0.25), P(0.64, -0.14), P(0.56, -0.08)],
    [P(0.56, -0.08), P(0.54, -0.04), P(0.55, 0), b],
    line(b, end),
  ];
}

function line(a: Pt, b: Pt): Seg {
  return [a, a, b, b];
}

/**
 * Map a profile drawn on (0,0)→(1,0) onto the edge A→B. The profile's −y side
 * is mapped to the left of A→B when sign = +1, to the right when sign = −1.
 */
function mapProfile(profile: Seg[], A: Pt, B: Pt, sign: number): Seg[] {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  // Left normal of direction (dx, dy) in screen coords (y down) is (dy, -dx).
  const nx = dy;
  const ny = -dx;
  const map = (p: Pt): Pt => ({
    x: A.x + p.x * dx + -p.y * sign * nx,
    y: A.y + p.x * dy + -p.y * sign * ny,
  });
  return profile.map((s) => s.map(map) as Seg);
}

export function reverseEdge(edge: Seg[]): Seg[] {
  return edge.map(([a, b, c, d]) => [d, c, b, a] as Seg).reverse();
}

export type PieceShape = {
  /** Grid position. */
  col: number;
  row: number;
  /** Closed outline, clockwise, in world units. */
  outline: Seg[];
  /** True if the piece is on the border of the puzzle. */
  isEdge: boolean;
};

/**
 * Build all piece outlines. Each internal edge is generated once in a canonical
 * direction (left→right or top→bottom) and shared by the two neighbours, so
 * they always fit together exactly.
 */
export function buildPieces(grid: Grid, seed: number): PieceShape[] {
  const { cols, rows } = grid;
  const rand = mulberry32(seed);
  const jitter = () => ({ shift: (rand() - 0.5) * 0.12, size: 0.9 + rand() * 0.2, sign: rand() < 0.5 ? 1 : -1 });

  // horizontal[r][c]: edge on line y=r from x=c to x=c+1 (r = 1..rows-1 internal)
  const horizontal: Seg[][][] = [];
  for (let r = 0; r <= rows; r++) {
    horizontal[r] = [];
    for (let c = 0; c < cols; c++) {
      const A = { x: c, y: r };
      const B = { x: c + 1, y: r };
      if (r === 0 || r === rows) {
        horizontal[r][c] = [line(A, B)];
      } else {
        const j = jitter();
        horizontal[r][c] = mapProfile(tabProfile(j.shift, j.size), A, B, j.sign);
      }
    }
  }
  // vertical[r][c]: edge on line x=c from y=r to y=r+1
  const vertical: Seg[][][] = [];
  for (let r = 0; r < rows; r++) {
    vertical[r] = [];
    for (let c = 0; c <= cols; c++) {
      const A = { x: c, y: r };
      const B = { x: c, y: r + 1 };
      if (c === 0 || c === cols) {
        vertical[r][c] = [line(A, B)];
      } else {
        const j = jitter();
        vertical[r][c] = mapProfile(tabProfile(j.shift, j.size), A, B, j.sign);
      }
    }
  }

  const pieces: PieceShape[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const outline = [
        ...horizontal[r][c], // top, left → right
        ...vertical[r][c + 1], // right, top → bottom
        ...reverseEdge(horizontal[r + 1][c]), // bottom, right → left
        ...reverseEdge(vertical[r][c]), // left, bottom → top
      ];
      pieces.push({ col: c, row: r, outline, isEdge: r === 0 || c === 0 || r === rows - 1 || c === cols - 1 });
    }
  }
  return pieces;
}

/** Trace an outline into a canvas path, translated by (-ox, -oy) and scaled. */
export function traceOutline(
  ctx: CanvasRenderingContext2D | Path2D,
  outline: Seg[],
  ox: number,
  oy: number,
  scale: number,
): void {
  const X = (p: Pt) => (p.x - ox) * scale;
  const Y = (p: Pt) => (p.y - oy) * scale;
  ctx.moveTo(X(outline[0][0]), Y(outline[0][0]));
  for (const [, c1, c2, e] of outline) {
    ctx.bezierCurveTo(X(c1), Y(c1), X(c2), Y(c2), X(e), Y(e));
  }
  ctx.closePath();
}
