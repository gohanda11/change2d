import { describe, it, expect } from 'vitest';
import { detectSegments, toDxfArcAngles } from './arcDetector';

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

function roundedRect(w: number, h: number, r: number, nPerArc = 12): [number, number][] {
  const pts: [number, number][] = [];
  const addArc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= nPerArc; i++) {
      const t = i / nPerArc;
      const a = a0 + (a1 - a0) * t;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  pts.push([r, 0]);
  pts.push([w - r, 0]);
  addArc(w - r, r, -Math.PI / 2, 0);
  pts.push([w, h - r]);
  addArc(w - r, h - r, 0, Math.PI / 2);
  pts.push([r, h]);
  addArc(r, h - r, Math.PI / 2, Math.PI);
  pts.push([0, r]);
  addArc(r, r, Math.PI, 1.5 * Math.PI);
  const cleaned: [number, number][] = [];
  for (const p of pts) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) cleaned.push(p);
  }
  if (
    cleaned.length > 1 &&
    Math.hypot(
      cleaned[0][0] - cleaned[cleaned.length - 1][0],
      cleaned[0][1] - cleaned[cleaned.length - 1][1]
    ) < 1e-9
  ) {
    cleaned.pop();
  }
  return cleaned;
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

    const segments = detectSegments(loop);
    const arc = segments.find((s) => s.type === 'arc');
    expect(arc).toBeDefined();
    if (!arc || arc.type !== 'arc') return;

    expect(arc.radius).toBeCloseTo(1, 2);
    expect(arc.isFullCircle).toBe(false);
    expect(Math.abs(arc.sweepDegrees)).toBeGreaterThan(80);
    expect(Math.abs(arc.sweepDegrees)).toBeLessThan(100);
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

  it('does not turn dense straight edges into huge-radius arcs', () => {
    const loop: [number, number][] = [];
    // dense bottom edge
    for (let i = 0; i <= 40; i++) loop.push([i * 0.5, 0]);
    // right edge
    for (let i = 1; i <= 40; i++) loop.push([20, i * 0.25]);
    // top edge
    for (let i = 1; i <= 40; i++) loop.push([20 - i * 0.5, 10]);
    // left edge
    for (let i = 1; i < 40; i++) loop.push([0, 10 - i * 0.25]);

    const segments = detectSegments(loop);
    const arcs = segments.filter((s) => s.type === 'arc');
    expect(arcs.length).toBe(0);
    expect(segments.every((s) => s.type === 'line')).toBe(true);
  });

  it('keeps real corner fillets on a rounded rectangle', () => {
    const loop = roundedRect(20, 10, 2, 12);
    const segments = detectSegments(loop);
    const arcs = segments.filter((s) => s.type === 'arc');
    expect(arcs.length).toBe(4);
    for (const seg of arcs) {
      if (seg.type !== 'arc') continue;
      expect(seg.radius).toBeCloseTo(2, 1);
      expect(seg.radius).toBeLessThan(10);
      const { startAngle, endAngle } = toDxfArcAngles(seg);
      let sweep = endAngle - startAngle;
      if (sweep <= 0) sweep += 360;
      expect(sweep).toBeLessThan(180);
      expect(sweep).toBeGreaterThan(60);
    }
  });

  it('rejects oversized corner fillets that should be sharp corners', () => {
    // R=30 on a 14mm square is not a real key-cutout fillet
    const w = 14;
    const r = 30;
    const pts: [number, number][] = [];
    const addArc = (cx: number, cy: number, a0: number, a1: number) => {
      for (let i = 1; i <= 16; i++) {
        const a = a0 + ((a1 - a0) * i) / 16;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    pts.push([0, 0]);
    // pretend only one corner has huge R geometry in the mesh
    pts.push([w - 0.01, 0]);
    addArc(w - r, r, -Math.PI / 2, 0);
    pts.push([w, w]);
    pts.push([0, w]);
    const segments = detectSegments(pts);
    const huge = segments.filter((s) => s.type === 'arc' && s.radius > 12);
    expect(huge.length).toBe(0);
  });

  it('keeps small real fillets (R<=2)', () => {
    const loop = roundedRect(20, 10, 1.2, 14);
    const arcs = detectSegments(loop).filter((s) => s.type === 'arc');
    expect(arcs.length).toBeGreaterThanOrEqual(4);
    for (const a of arcs) {
      if (a.type !== 'arc') continue;
      expect(a.radius).toBeLessThan(3);
      expect(Math.abs(a.sweepDegrees)).toBeGreaterThan(50);
      expect(Math.abs(a.sweepDegrees)).toBeLessThan(130);
    }
  });

  it('exports CW fillet as short DXF arc not 270deg', () => {
    const loop = roundedRect(20, 10, 1.5, 12).reverse();
    const arcs = detectSegments(loop).filter((s) => s.type === 'arc');
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    for (const a of arcs) {
      if (a.type !== 'arc') continue;
      const { startAngle, endAngle } = toDxfArcAngles(a);
      let sweep = endAngle - startAngle;
      while (sweep <= 0) sweep += 360;
      expect(sweep).toBeLessThan(180);
      expect(Math.abs(sweep - Math.abs(a.sweepDegrees))).toBeLessThan(25);
    }
  });


  it('keeps tessellated sharp rectangle corners as lines (not tiny arcs)', () => {
    const w = 20;
    const h = 12;
    const dens = 25;
    const loop: [number, number][] = [];
    for (let i = 0; i < dens; i++) loop.push([(w * i) / dens, 0]);
    for (let i = 0; i < dens; i++) loop.push([w, (h * i) / dens]);
    for (let i = 0; i < dens; i++) loop.push([w - (w * i) / dens, h]);
    for (let i = 0; i < dens; i++) loop.push([0, h - (h * i) / dens]);
    const segments = detectSegments(loop);
    const arcs = segments.filter((s) => s.type === 'arc');
    expect(arcs.length).toBe(0);
    expect(segments.every((s) => s.type === 'line')).toBe(true);
  });

  it('does not convert a dense L-corner into an arc', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 30; i++) pts.push([i * 0.4, 0]);
    for (let i = 1; i <= 30; i++) pts.push([12, i * 0.4]);
    pts.push([0, 12]);
    const segments = detectSegments(pts);
    const cornerArcs = segments.filter(
      (s) => s.type === 'arc' && !s.isFullCircle && Math.abs(s.sweepDegrees) > 40
    );
    expect(cornerArcs.length).toBe(0);
  });

  it('forces DXF short arc even if start/end would take the long way', () => {
    const fake = {
      type: 'arc' as const,
      center: { x: 0, y: 0 },
      radius: 1,
      startAngle: 0,
      endAngle: 90,
      startPoint: { x: 1, y: 0 },
      endPoint: { x: 0, y: 1 },
      clockwise: true, // model walked CW, sweep -90
      isFullCircle: false,
      sweepDegrees: -90,
    };
    const { startAngle, endAngle } = toDxfArcAngles(fake);
    let sweep = endAngle - startAngle;
    while (sweep <= 0) sweep += 360;
    expect(sweep).toBeLessThanOrEqual(180);
    expect(sweep).toBeCloseTo(90, 5);
  });

});
