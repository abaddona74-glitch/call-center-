import { describe, expect, it } from 'vitest';
import { centeredView, clampScale, fitView, scaleAround, zoomAround, zoomPercent } from './viewport';

describe('guide canvas viewport', () => {
  it('clamps the scale to 25%–300%', () => {
    expect(clampScale(0.1)).toBe(0.25);
    expect(clampScale(5)).toBe(3);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('zooms around a point: that point stays where it is', () => {
    const v = zoomAround({ scale: 1, x: 100, y: 40 }, 2, 300, 200);
    expect(v.scale).toBe(2);
    // the layer point under the cursor was ((300-100)/1, (200-40)/1) = (200, 160)
    expect(300 - v.x).toBeCloseTo(200 * 2);
    expect(200 - v.y).toBeCloseTo(160 * 2);
  });

  it('does not move when the scale is already at a limit', () => {
    const v = { scale: 3, x: -50, y: 10 };
    expect(zoomAround(v, 1.2, 400, 300)).toEqual(v);
    expect(scaleAround({ scale: 0.25, x: 0, y: 0 }, 0.1, 10, 10)).toEqual({ scale: 0.25, x: 0, y: 0 });
  });

  it('fit: scales a too-wide tree down to the viewport, never above 100%', () => {
    // 1290 px of tree + 2×100 px layer padding in a 1200 px viewport
    const v = fitView(1200, 1490);
    expect(v.scale).toBeCloseTo((1200 - 48) / 1290);
    expect(v.x + (1490 * v.scale) / 2).toBeCloseTo(600); // centered
    expect(fitView(1600, 1490)).toEqual(centeredView(1600, 1490));
    expect(fitView(100, 5000).scale).toBe(0.25);
  });

  it('centers the layer at 100%', () => {
    expect(centeredView(1200, 1600)).toEqual({ scale: 1, x: -200, y: 60 });
    expect(zoomPercent({ scale: 1.2 * 1.2, x: 0, y: 0 })).toBe(144);
  });
});
