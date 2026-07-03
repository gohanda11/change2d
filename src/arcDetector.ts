interface Point2D {
  x: number;
  y: number;
}

export interface ArcSegment {
  type: 'arc';
  center: Point2D;
  radius: number;
  startAngle: number; // degrees, 0-360
  endAngle: number;   // degrees, 0-360
  startPoint: Point2D;
  endPoint: Point2D;
  clockwise: boolean;
  isFullCircle: boolean;
}

export interface LineSegment {
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export type Segment = ArcSegment | LineSegment;

const CIRCLE_TOLERANCE = 0.02; // mm
const MIN_ARC_POINTS = 4;
const MAX_ARC_STEP_RAD = (30 * Math.PI) / 180; // reject polygon edges inscribed in a circle
const FULL_CIRCLE_THRESHOLD = 2 * Math.PI - 0.05;

function fitCircle3(p1: Point2D, p2: Point2D, p3: Point2D): { center: Point2D; radius: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-10) return null;

  const sq1 = p1.x * p1.x + p1.y * p1.y;
  const sq2 = p2.x * p2.x + p2.y * p2.y;
  const sq3 = p3.x * p3.x + p3.y * p3.y;

  const ux = (sq1 * (p2.y - p3.y) + sq2 * (p3.y - p1.y) + sq3 * (p1.y - p2.y)) / d;
  const uy = (sq1 * (p3.x - p2.x) + sq2 * (p1.x - p3.x) + sq3 * (p2.x - p1.x)) / d;

  const center = { x: ux, y: uy };
  const radius = Math.hypot(p1.x - ux, p1.y - uy);
  return { center, radius };
}

function pointOnCircle(p: Point2D, circle: { center: Point2D; radius: number }, tolerance: number): boolean {
  return Math.abs(Math.hypot(p.x - circle.center.x, p.y - circle.center.y) - circle.radius) <= tolerance;
}

function angleOf(p: Point2D, center: Point2D): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function normalizeDegrees(rad: number): number {
  let deg = (rad * 180) / Math.PI;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return deg;
}

function unwrapDelta(current: number, previous: number): number {
  let delta = current - previous;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function findArcEnd(points: Point2D[], start: number, tolerance: number): number {
  const n = points.length;
  if (n < 3) return start + 1;

  const p1 = points[start % n];
  const p2 = points[(start + 1) % n];
  const p3 = points[(start + 2) % n];

  // Degenerate input (duplicate points) cannot form a circle.
  if (p1 === p2 || p2 === p3) return start + 2;

  const circle = fitCircle3(p1, p2, p3);
  if (!circle) return start + 2;

  // Very large radius is effectively a straight line.
  if (!Number.isFinite(circle.radius) || circle.radius > 10000) return start + 2;

  let end = start + 3;
  let prevAngle = angleOf(p3, circle.center);
  let accumulated = 0;
  let direction = 0;

  while (end - start < n) {
    const p = points[end % n];
    if (!pointOnCircle(p, circle, tolerance)) break;

    const angle = angleOf(p, circle.center);
    const delta = unwrapDelta(angle, prevAngle);

    if (Math.abs(delta) < 0.001) break;
    if (Math.abs(delta) > MAX_ARC_STEP_RAD) break;

    if (direction === 0) {
      direction = Math.sign(delta);
    } else if (Math.sign(delta) !== direction) {
      break;
    }

    accumulated += delta;
    prevAngle = angle;
    end++;

    if (Math.abs(accumulated) >= FULL_CIRCLE_THRESHOLD) {
      break;
    }
  }

  return end;
}

function fitArc(points: Point2D[], start: number, end: number): ArcSegment | null {
  const n = points.length;
  const count = end - start;
  if (count < 3) return null;

  const p1 = points[start % n];
  const p2 = points[Math.floor((start + end) / 2) % n];
  const p3 = points[(end - 1) % n];

  const circle = fitCircle3(p1, p2, p3);
  if (!circle || !Number.isFinite(circle.radius)) return null;

  const startAngle = angleOf(p1, circle.center);
  const endAngle = angleOf(p3, circle.center);

  const midPoint = points[(start + 1) % n];
  const midDelta = unwrapDelta(angleOf(midPoint, circle.center), startAngle);
  const clockwise = midDelta < 0;

  const accumulated = unwrapDelta(endAngle, startAngle);
  const isFullCircle =
    Math.abs(accumulated) >= FULL_CIRCLE_THRESHOLD || count >= n - 1;

  return {
    type: 'arc',
    center: circle.center,
    radius: circle.radius,
    startAngle: normalizeDegrees(startAngle),
    endAngle: normalizeDegrees(endAngle),
    startPoint: p1,
    endPoint: p3,
    clockwise,
    isFullCircle,
  };
}

export function detectSegments(loop: [number, number][]): Segment[] {
  if (loop.length < 3) {
    if (loop.length === 2) {
      return [{ type: 'line', start: { x: loop[0][0], y: loop[0][1] }, end: { x: loop[1][0], y: loop[1][1] } }];
    }
    return [];
  }

  const points = loop.map(([x, y]) => ({ x, y }));
  const n = points.length;
  const segments: Segment[] = [];
  let i = 0;
  let edgesConsumed = 0;

  while (edgesConsumed < n) {
    const arcEnd = findArcEnd(points, i, CIRCLE_TOLERANCE);
    const arcCount = arcEnd - i;

    if (arcCount >= MIN_ARC_POINTS) {
      const arc = fitArc(points, i, arcEnd);
      if (arc) {
        segments.push(arc);
        if (arc.isFullCircle) break;
        edgesConsumed += arcCount;
        i = arcEnd % n;
        continue;
      }
    }

    const j = (i + 1) % n;
    segments.push({ type: 'line', start: points[i], end: points[j] });
    edgesConsumed += 1;
    i = j;
  }

  return segments;
}
