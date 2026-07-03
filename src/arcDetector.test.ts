import { describe, it, expect } from 'vitest';
import { detectSegments } from './arcDetector';

function circlePoints(center: { x: number; y: number }, radius: number, count: number): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    points.push([
      center.x + radius * Math.cos(angle),
      center.y + radius * Math.sin(angle),
    ]);
  }
  return points;
}

describe('detectSegments', () => {
  it('detects a full circle as a single arc segment', () => {
    const loop = circlePoints({ x: 10, y: 20 }, 5, 32);
    const segments = detectSegments(loop);

    expect(segments.length).toBe(1);
    const arc = segments[0];
    expect(arc.type).toBe('arc');
    if (arc.type !== 'arc') return;

    expect(arc.isFullCircle).toBe(true);
    expect(arc.center.x).toBeCloseTo(10, 1);
    expect(arc.center.y).toBeCloseTo(20, 1);
    expect(arc.radius).toBeCloseTo(5, 1);
  });

  it('detects a 90-degree arc', () => {
    const loop: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * (Math.PI / 2);
      loop.push([Math.cos(angle), Math.sin(angle)]);
    }
    loop.push([0, 0]);
    loop.push([1, 0]);

    const segments = detectSegments(loop);
    const arc = segments.find((s) => s.type === 'arc');
    expect(arc).toBeDefined();
    if (!arc || arc.type !== 'arc') return;

    expect(arc.radius).toBeCloseTo(1, 2);
    expect(arc.isFullCircle).toBe(false);
  });

  it('falls back to line segments for a square', () => {
    const loop: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    const segments = detectSegments(loop);
    expect(segments.every((s) => s.type === 'line')).toBe(true);
    expect(segments.length).toBe(4);
  });
});
