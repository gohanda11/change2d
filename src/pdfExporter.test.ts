import { describe, expect, it } from 'vitest';
import { generateAnnotatedPdf, pageArcSweepDegrees, needsCanvasTextForTest } from './pdfExporter';
import type { Point2 } from './geometry2d';

const square: Point2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('pdfExporter', () => {
  it('builds a pdf buffer', () => {
    const buf = generateAnnotatedPdf([square], {
      hatchEnabled: true,
      hatchSpacing: 2,
      hatchAngleDeg: 45,
      dimensions: [
        { kind: 'linear', p1: [0, 0], p2: [10, 0], offset: 3 },
        { kind: 'diameter', center: [5, 5], radius: 2, angle: Math.PI / 4 },
      ],
      texts: [{ position: [1, 8], content: 'NOTE', height: 2 }],
    });
    expect(buf.byteLength).toBeGreaterThan(100);
    expect(String.fromCharCode(...new Uint8Array(buf.slice(0, 4)))).toBe('%PDF');
  });

  it('maps model CCW 90deg fillet to short page sweep', () => {
    const ccw = pageArcSweepDegrees(0, 90, false);
    expect(ccw.sweep).toBeCloseTo(90, 5);

    const cw = pageArcSweepDegrees(90, 0, true);
    expect(cw.sweep).toBeCloseTo(90, 5);
  });

  it('does not take the long way for a typical corner fillet', () => {
    const a = pageArcSweepDegrees(180, 270, false);
    expect(a.sweep).toBeLessThan(180);
    expect(a.sweep).toBeCloseTo(90, 5);
  });

  it('detects japanese text that needs canvas rendering', () => {
    expect(needsCanvasTextForTest('NOTE')).toBe(false);
    expect(needsCanvasTextForTest('4 × M2')).toBe(true);
    expect(needsCanvasTextForTest('公差はISO')).toBe(true);
    expect(needsCanvasTextForTest('⌀2')).toBe(true);
  });

  it('accepts japanese annotations without throwing', () => {
    const buf = generateAnnotatedPdf([square], {
      hatchEnabled: false,
      dimensions: [],
      texts: [{ position: [1, 8], content: '公差はISO 2768-m', height: 2 }],
    });
    expect(buf.byteLength).toBeGreaterThan(100);
  });
});
