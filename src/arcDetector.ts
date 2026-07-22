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
  /** 符号付きスイープ角（度）。負 = clockwise */
  sweepDegrees: number;
}

export interface LineSegment {
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export type Segment = ArcSegment | LineSegment;

const CIRCLE_TOLERANCE = 0.02; // mm
const MIN_ARC_POINTS = 4;
const MAX_ARC_STEP_RAD = (30 * Math.PI) / 180;
const FULL_CIRCLE_THRESHOLD = 2 * Math.PI - 0.05;
/** これより大きい半径は直線扱い（mm） */
const ABSURD_RADIUS = 10000;
/** 部分円弧（フィレット等）として許す最大半径。これ超は直線近似 */
const MAX_PARTIAL_ARC_RADIUS = 12;
/** 弦長に対する半径の上限倍率（ゆるい巨大Rを落とす） */
const MAX_RADIUS_TO_CHORD = 2.5;
/** 円より直線の方が良く当てはまるときの判定倍率 */
const LINE_VS_CIRCLE_RATIO = 1.25;

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

function distPointToLine(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

function maxDistToLine(points: Point2D[], start: number, end: number): number {
  const n = points.length;
  const a = points[start % n];
  const b = points[(end - 1) % n];
  let max = 0;
  for (let k = start; k < end; k++) {
    max = Math.max(max, distPointToLine(points[k % n], a, b));
  }
  return max;
}

function maxDistToCircle(
  points: Point2D[],
  start: number,
  end: number,
  circle: { center: Point2D; radius: number }
): number {
  const n = points.length;
  let max = 0;
  for (let k = start; k < end; k++) {
    const p = points[k % n];
    max = Math.max(max, Math.abs(Math.hypot(p.x - circle.center.x, p.y - circle.center.y) - circle.radius));
  }
  return max;
}

/**
 * ほぼ直線／直角の角を巨大Rの弧として誤検出しない。
 * キーボードプレートでは部分円弧のRは小さい（フィレット程度）想定。
 */
function prefersLineOverCircle(
  points: Point2D[],
  start: number,
  end: number,
  circle: { center: Point2D; radius: number },
  sweepRad: number
): boolean {
  if (!Number.isFinite(circle.radius) || circle.radius > ABSURD_RADIUS) return true;
  const count = end - start;
  if (count < MIN_ARC_POINTS) return true;

  const absSweep = Math.abs(sweepRad);
  const n = points.length;
  const a = points[start % n];
  const b = points[(end - 1) % n];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const lineDev = maxDistToLine(points, start, end);
  const circleDev = maxDistToCircle(points, start, end, circle);

  // メッシュ公差〜ノイズ程度なら直線
  if (lineDev <= Math.max(CIRCLE_TOLERANCE * 3, 0.05)) return true;

  // フル円以外で大きすぎるRは直線群へ（角の誤検出防止）
  if (circle.radius > MAX_PARTIAL_ARC_RADIUS) return true;

  // 平坦すぎる弧（小さなスイープ）
  if (absSweep < (35 * Math.PI) / 180) return true;

  // 弦に対してRが大きすぎる = ゆるい円弧の誤検出
  if (chord > 1e-9 && circle.radius > chord * MAX_RADIUS_TO_CHORD) return true;

  // 直線フィットが円と同程度以上に良い
  if (lineDev <= circleDev * LINE_VS_CIRCLE_RATIO) return true;

  // サジッタが小さすぎる（目視では直線）
  const sagitta =
    circle.radius > 1e-9
      ? circle.radius * (1 - Math.cos(Math.min(absSweep, Math.PI) / 2))
      : 0;
  if (sagitta < 0.08) return true;

  return false;
}

function collinearWithLine(pStart: Point2D, pEnd: Point2D, p3: Point2D, tolerance: number): boolean {
  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-10) return false;
  const cross = Math.abs(dx * (p3.y - pStart.y) - dy * (p3.x - pStart.x));
  return cross <= tolerance * len;
}

function findLineEnd(points: Point2D[], start: number, tolerance: number): number {
  const n = points.length;
  if (n < 3) return start + 1;

  let end = start + 2;
  while (end - start < n) {
    const pStart = points[start % n];
    const pEnd = points[(end - 1) % n];
    const p3 = points[end % n];
    if (!collinearWithLine(pStart, pEnd, p3, tolerance)) break;
    end++;
  }
  return end;
}

function findArcEnd(points: Point2D[], start: number, tolerance: number): number {
  const n = points.length;
  if (n < 3) return start + 1;

  const p1 = points[start % n];
  const p2 = points[(start + 1) % n];
  const p3 = points[(start + 2) % n];

  if (p1 === p2 || p2 === p3) return start + 2;

  const circle = fitCircle3(p1, p2, p3);
  if (!circle) return start + 2;
  if (!Number.isFinite(circle.radius) || circle.radius > ABSURD_RADIUS) return start + 2;
  // 探索段階では少し緩め（フル円の穴を潰さない）。部分弧の最終判定は fitArc 側。
  if (circle.radius > MAX_PARTIAL_ARC_RADIUS * 8) return start + 2;

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

  let accumulated = 0;
  let prev = startAngle;
  for (let k = start + 1; k < end; k++) {
    const angle = angleOf(points[k % n], circle.center);
    accumulated += unwrapDelta(angle, prev);
    prev = angle;
  }

  const isFullCircle =
    Math.abs(accumulated) >= FULL_CIRCLE_THRESHOLD || end % n === start % n;

  // フル円（穴など）は大きなRでも残す。部分弧だけ厳しく落とす。
  if (!isFullCircle && prefersLineOverCircle(points, start, end, circle, accumulated)) {
    return null;
  }

  const clockwise = accumulated < 0;
  const sweepDegrees = (accumulated * 180) / Math.PI;

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
    sweepDegrees,
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
        edgesConsumed += arcCount - 1;
        i = (arcEnd - 1) % n;
        continue;
      }
    }

    const lineEnd = findLineEnd(points, i, CIRCLE_TOLERANCE);
    const lineCount = lineEnd - i;
    segments.push({
      type: 'line',
      start: points[i % n],
      end: points[(lineEnd - 1) % n],
    });
    edgesConsumed += lineCount - 1;
    i = (lineEnd - 1) % n;
  }

  return segments;
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

function ccwSweepDeg(start: number, end: number): number {
  let s = normalizeDeg(end) - normalizeDeg(start);
  if (s <= 0) s += 360;
  return s;
}

function angleOnCcwArc(start: number, end: number, mid: number): boolean {
  const s = normalizeDeg(start);
  const e = normalizeDeg(end);
  const m = normalizeDeg(mid);
  if (s <= e) return m >= s && m <= e;
  return m >= s || m <= e;
}

/** DXF ARC は常に CCW。点列の中点角度が載る側を選んで長弧化を防ぐ */
export function toDxfArcAngles(seg: ArcSegment): { startAngle: number; endAngle: number } {
  const start = normalizeDeg(seg.startAngle);
  const end = normalizeDeg(seg.endAngle);
  const mid = normalizeDeg(seg.startAngle + seg.sweepDegrees / 2);
  const absSweep = Math.min(Math.abs(seg.sweepDegrees), 360);

  const direct = { startAngle: start, endAngle: end };
  const swapped = { startAngle: end, endAngle: start };

  const directOk = angleOnCcwArc(direct.startAngle, direct.endAngle, mid);
  const swappedOk = angleOnCcwArc(swapped.startAngle, swapped.endAngle, mid);

  if (directOk && !swappedOk) return direct;
  if (swappedOk && !directOk) return swapped;

  // 両方 or どちらでもないときは、|sweep| に近い CCW スイープを選ぶ
  const d1 = Math.abs(ccwSweepDeg(direct.startAngle, direct.endAngle) - absSweep);
  const d2 = Math.abs(ccwSweepDeg(swapped.startAngle, swapped.endAngle) - absSweep);
  return d1 <= d2 ? direct : swapped;
}
