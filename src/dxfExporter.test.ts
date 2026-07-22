import { describe, expect, it } from 'vitest';
import { generateAnnotatedDxf, generateDxf } from './dxfExporter';
import type { Point2 } from './geometry2d';

const square: Point2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('dxfExporter annotations', () => {
  it('keeps plain dxf working', () => {
    const dxf = generateDxf([square]);
    expect(dxf).toContain('LINE');
    expect(dxf).toContain('ENTITIES');
  });

  it('exports hatch, linear dimension and text', () => {
    const dxf = generateAnnotatedDxf([square], {
      hatchEnabled: true,
      hatchSpacing: 2,
      hatchAngleDeg: 45,
      dimensions: [{ kind: 'linear', p1: [0, 0], p2: [10, 0], offset: 3 }],
      texts: [{ position: [1, 1], content: 'NOTE', height: 2 }],
    });
    expect(dxf).toContain('HATCH');
    expect(dxf).toContain('DIMENSION');
    expect(dxf).toContain('NOTE');
    expect(dxf).toContain('10');
  });

  it('exports diameter dimension', () => {
    const dxf = generateAnnotatedDxf([square], {
      hatchEnabled: false,
      dimensions: [{ kind: 'diameter', center: [5, 5], radius: 2, angle: 0 }],
      texts: [],
    });
    expect(dxf).toContain('DIMENSION');
    expect(dxf).toContain('⌀4');
  });

  it('exports custom diameter label text and position', () => {
    const dxf = generateAnnotatedDxf([square], {
      hatchEnabled: false,
      dimensions: [{
        kind: 'diameter',
        center: [5, 5],
        radius: 2,
        angle: 0,
        label: 'CUSTOM_DIA',
        labelPosition: [8, 9],
      }],
      texts: [],
    });
    expect(dxf).toContain('CUSTOM_DIA');
  });
});
