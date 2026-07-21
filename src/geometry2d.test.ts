import { describe, expect, it } from 'vitest';
import {
  classifyLoops,
  formatLength,
  isInsideFace,
  pointInPolygon,
  polygonArea,
  type Point2,
} from './geometry2d';

describe('geometry2d', () => {
  const square: Point2[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const hole: Point2[] = [
    [3, 3],
    [7, 3],
    [7, 7],
    [3, 7],
  ];

  it('computes polygon area', () => {
    expect(Math.abs(polygonArea(square))).toBe(100);
  });

  it('classifies largest loop as outer', () => {
    const { outer, holes } = classifyLoops([hole, square]);
    expect(outer).toBe(square);
    expect(holes).toEqual([hole]);
  });

  it('point in polygon / face with hole', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([5, 5], hole)).toBe(true);
    expect(isInsideFace([5, 5], square, [hole])).toBe(false);
    expect(isInsideFace([1, 1], square, [hole])).toBe(true);
  });

  it('formats length', () => {
    expect(formatLength(10)).toBe('10');
    expect(formatLength(10.5)).toBe('10.5');
    expect(formatLength(10.25)).toBe('10.25');
  });
});
