import {
  boundingBox,
  classifyLoops,
  isInsideFace,
  type Point2,
} from './geometry2d';

export interface HatchOptions {
  spacing?: number;
  angleDeg?: number;
}

export interface HatchLine {
  start: Point2;
  end: Point2;
}

/**
 * 面の内側（外形内・穴の外）に斜線ハッチを生成する。
 * 線分はポリゴン辺との交点でクリップする。
 */
export function generateHatchLines(
  loops: Point2[][],
  options: HatchOptions = {}
): HatchLine[] {
  if (loops.length === 0) return [];

  const { outer, holes } = classifyLoops(loops);
  if (outer.length < 3) return [];

  const box = boundingBox(loops);
  const angleDeg = options.angleDeg ?? 45;
  const spacing =
    options.spacing ??
    Math.min(5, Math.max(0.8, box.diagonal / 40 || 2));

  const angle = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;

  const corners: Point2[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];

  let minT = Infinity;
  let maxT = -Infinity;
  for (const [x, y] of corners) {
    const t = x * perpX + y * perpY;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  minT -= spacing;
  maxT += spacing;

  const pad = box.diagonal + spacing * 2;
  const lines: HatchLine[] = [];

  for (let t = minT; t <= maxT + 1e-9; t += spacing) {
    const cx = perpX * t;
    const cy = perpY * t;
    const p0: Point2 = [cx - dirX * pad, cy - dirY * pad];
    const p1: Point2 = [cx + dirX * pad, cy + dirY * pad];
    lines.push(...clipLineToFace(p0, p1, outer, holes));
  }

  return lines;
}

function clipLineToFace(
  a: Point2,
  b: Point2,
  outer: Point2[],
  holes: Point2[][]
): HatchLine[] {
  const params = new Set<number>([0, 1]);

  collectEdgeIntersections(a, b, outer, params);
  for (const hole of holes) {
    collectEdgeIntersections(a, b, hole, params);
  }

  const sorted = [...params].sort((x, y) => x - y);
  const result: HatchLine[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const midT = (t0 + t1) / 2;
    const mid: Point2 = [
      a[0] + (b[0] - a[0]) * midT,
      a[1] + (b[1] - a[1]) * midT,
    ];
    if (!isInsideFace(mid, outer, holes)) continue;
    result.push({
      start: [
        a[0] + (b[0] - a[0]) * t0,
        a[1] + (b[1] - a[1]) * t0,
      ],
      end: [
        a[0] + (b[0] - a[0]) * t1,
        a[1] + (b[1] - a[1]) * t1,
      ],
    });
  }

  return result;
}

function collectEdgeIntersections(
  a: Point2,
  b: Point2,
  loop: Point2[],
  params: Set<number>
): void {
  for (let i = 0; i < loop.length; i++) {
    const c = loop[i];
    const d = loop[(i + 1) % loop.length];
    const t = segmentIntersectionParam(a, b, c, d);
    if (t !== null) params.add(t);
  }
}

/** 線分 AB 上のパラメータ t (0..1) で、CD との交点を返す */
function segmentIntersectionParam(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2
): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;

  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return Math.min(1, Math.max(0, t));
}
