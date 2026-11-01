import { describe, expect, it } from 'vitest';
import { buildPieces, chooseGrid, reverseEdge, TAB_REACH } from './geometry';

describe('chooseGrid', () => {
  it.each([
    [12, 4 / 3],
    [24, 3 / 2],
    [48, 16 / 9],
    [96, 1],
    [150, 3 / 4],
  ])('gets close to %i pieces with near-square cells for aspect %f', (target, aspect) => {
    const { cols, rows } = chooseGrid(target, aspect);
    expect(Math.abs(cols * rows - target) / target).toBeLessThan(0.2);
    const cellAspect = (aspect * rows) / cols;
    expect(cellAspect).toBeGreaterThan(0.75);
    expect(cellAspect).toBeLessThan(1.33);
  });
});

describe('buildPieces', () => {
  const grid = { cols: 5, rows: 4 };
  const pieces = buildPieces(grid, 1234);

  it('builds one closed outline per cell', () => {
    expect(pieces).toHaveLength(20);
    for (const p of pieces) {
      for (let i = 0; i < p.outline.length; i++) {
        const end = p.outline[i][3];
        const next = p.outline[(i + 1) % p.outline.length][0];
        expect(end.x).toBeCloseTo(next.x, 9);
        expect(end.y).toBeCloseTo(next.y, 9);
      }
    }
  });

  it('keeps tabs within the bitmap padding', () => {
    for (const p of pieces) {
      for (const seg of p.outline) {
        for (const pt of seg) {
          expect(pt.x).toBeGreaterThanOrEqual(p.col - TAB_REACH);
          expect(pt.x).toBeLessThanOrEqual(p.col + 1 + TAB_REACH);
          expect(pt.y).toBeGreaterThanOrEqual(p.row - TAB_REACH);
          expect(pt.y).toBeLessThanOrEqual(p.row + 1 + TAB_REACH);
        }
      }
    }
  });

  it('has straight outer edges and flags edge pieces', () => {
    expect(pieces.filter((p) => p.isEdge)).toHaveLength(2 * 5 + 2 * 2);
  });

  it('is deterministic for a seed', () => {
    expect(buildPieces(grid, 1234)).toEqual(pieces);
    expect(buildPieces(grid, 99)).not.toEqual(pieces);
  });

  it('reverseEdge round-trips', () => {
    const e = pieces[6].outline.slice(0, 6);
    expect(reverseEdge(reverseEdge(e))).toEqual(e);
  });
});
