export type Point2 = [number, number];

export function polygonArea(loop: Point2[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

export function boundingBox(loops: Point2[][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  diagonal: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, diagonal: 0 };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    diagonal: Math.hypot(width, height),
  };
}

/** 面積最大のループを外形、それ以外を穴として分類 */
export function classifyLoops(loops: Point2[][]): {
  outer: Point2[];
  holes: Point2[][];
} {
  if (loops.length === 0) {
    return { outer: [], holes: [] };
  }
  let outerIndex = 0;
  let maxAbsArea = -1;
  for (let i = 0; i < loops.length; i++) {
    const absArea = Math.abs(polygonArea(loops[i]));
    if (absArea > maxAbsArea) {
      maxAbsArea = absArea;
      outerIndex = i;
    }
  }
  return {
    outer: loops[outerIndex],
    holes: loops.filter((_, i) => i !== outerIndex),
  };
}

export function pointInPolygon(point: Point2, loop: Point2[]): boolean {
  if (loop.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInsideFace(point: Point2, outer: Point2[], holes: Point2[][]): boolean {
  if (!pointInPolygon(point, outer)) return false;
  for (const hole of holes) {
    if (pointInPolygon(point, hole)) return false;
  }
  return true;
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function formatLength(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return String(Math.round(value));
  }
  return Number(value.toFixed(2)).toString();
}
