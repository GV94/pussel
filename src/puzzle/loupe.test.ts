import { describe, expect, it } from 'vitest';
import { loupePosition } from './game';

const r = 80;
const W = 400;

describe('loupePosition', () => {
  it('sits straight above the finger when there is room', () => {
    const { lx, ly } = loupePosition(200, 500, r, W);
    expect(lx).toBe(200);
    expect(ly + r).toBeLessThan(500);
  });

  it('is never below the finger, even at the very top', () => {
    for (const y of [0, 10, 50, 100, 150, 200, 250]) {
      for (const x of [0, 50, 200, 350, 400]) {
        const { lx, ly } = loupePosition(x, y, r, W);
        expect(ly).toBeLessThanOrEqual(y);
        // If it's not fully above, it must be off to the side, clear of the finger.
        if (ly + r >= y) expect(Math.abs(lx - x)).toBeGreaterThan(r);
      }
    }
  });

  it('moves left of the finger near the top, or right when there is no room on the left', () => {
    expect(loupePosition(350, 60, r, W).lx).toBeLessThan(350);
    expect(loupePosition(40, 60, r, W).lx).toBeGreaterThan(40);
  });
});
