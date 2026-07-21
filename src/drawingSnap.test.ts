import { describe, expect, it } from 'vitest';
import {
  collectCircles,
  collectCornerPoints,
  findNearestCircle,
  snapToPoints,
} from './drawingSnap';
import type { Point2 } from './geometry2d';

describe('drawingSnap', () => {
  it('collects unique corners', () => {
    const loops: Point2[][] = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ];
    expect(collectCornerPoints(loops)).toHaveLength(4);
  });

  it('snaps to nearby corner', () => {
    const corners: Point2[] = [
      [0, 0],
      [10, 0],
    ];
    expect(snapToPoints([0.2, 0.1], corners, 0.5)).toEqual([0, 0]);
    expect(snapToPoints([3, 3], corners, 0.5)).toBeNull();
  });

  it('detects full circles from square-ish? skip - use polygon circle points', () => {
    const n = 36;
    const loop: Point2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      loop.push([5 + Math.cos(a) * 2, 5 + Math.sin(a) * 2]);
    }
    const circles = collectCircles([loop]);
    expect(circles.length).toBeGreaterThanOrEqual(1);
    expect(circles[0].radius).toBeCloseTo(2, 1);
    const hit = findNearestCircle([5.1, 5], circles, 1);
    expect(hit).not.toBeNull();
  });
});
