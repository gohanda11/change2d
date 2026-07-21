import { describe, expect, it } from 'vitest';
import { generateHatchLines } from './hatch';
import { isInsideFace, classifyLoops, type Point2 } from './geometry2d';

describe('generateHatchLines', () => {
  const square: Point2[] = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ];
  const hole: Point2[] = [
    [6, 6],
    [14, 6],
    [14, 14],
    [6, 14],
  ];

  it('generates lines inside a square', () => {
    const lines = generateHatchLines([square], { spacing: 2, angleDeg: 45 });
    expect(lines.length).toBeGreaterThan(3);
    const mid = lines[Math.floor(lines.length / 2)];
    const midPoint: Point2 = [
      (mid.start[0] + mid.end[0]) / 2,
      (mid.start[1] + mid.end[1]) / 2,
    ];
    const { outer, holes } = classifyLoops([square]);
    expect(isInsideFace(midPoint, outer, holes)).toBe(true);
  });

  it('does not place hatch midpoints inside holes', () => {
    const lines = generateHatchLines([square, hole], { spacing: 1.5, angleDeg: 45 });
    expect(lines.length).toBeGreaterThan(0);
    const { outer, holes } = classifyLoops([square, hole]);
    for (const line of lines) {
      const mid: Point2 = [
        (line.start[0] + line.end[0]) / 2,
        (line.start[1] + line.end[1]) / 2,
      ];
      expect(isInsideFace(mid, outer, holes)).toBe(true);
    }
  });
});
