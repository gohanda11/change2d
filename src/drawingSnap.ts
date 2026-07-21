import { detectSegments } from './arcDetector';
import { distance, type Point2 } from './geometry2d';
import type { CircleFeature } from './drawingTypes';

/** ループ頂点をスナップ候補として収集（近接点は間引き） */
export function collectCornerPoints(loops: Point2[][], mergeTol = 1e-4): Point2[] {
  const points: Point2[] = [];
  for (const loop of loops) {
    for (const p of loop) {
      if (!points.some((q) => distance(p, q) <= mergeTol)) {
        points.push([p[0], p[1]]);
      }
    }
  }
  return points;
}

/** 輪郭から円（フルサークル）を抽出 */
export function collectCircles(loops: Point2[][], mergeTol = 0.05): CircleFeature[] {
  const circles: CircleFeature[] = [];
  for (const loop of loops) {
    for (const seg of detectSegments(loop)) {
      if (seg.type !== 'arc' || !seg.isFullCircle) continue;
      const center: Point2 = [seg.center.x, seg.center.y];
      const dup = circles.find(
        (c) =>
          distance(c.center, center) <= mergeTol &&
          Math.abs(c.radius - seg.radius) <= mergeTol
      );
      if (!dup) {
        circles.push({ center, radius: seg.radius });
      }
    }
  }
  return circles;
}

export function snapToPoints(
  point: Point2,
  candidates: Point2[],
  threshold: number
): Point2 | null {
  let best: Point2 | null = null;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = distance(point, c);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function findNearestCircle(
  point: Point2,
  circles: CircleFeature[],
  threshold: number
): CircleFeature | null {
  let best: CircleFeature | null = null;
  let bestDist = threshold;
  for (const c of circles) {
    const dCenter = distance(point, c.center);
    const dRim = Math.abs(dCenter - c.radius);
    const d = Math.min(dCenter, dRim);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
