import Drawing from 'dxf-writer';
import { detectSegments } from './arcDetector';
import { boundingBox, formatLength, type Point2 } from './geometry2d';
import { generateHatchLines } from './hatch';
import type {
  DrawingAnnotations,
  DimensionAnnotation,
  DiameterDimension,
  LinearDimension,
  TextAnnotation,
} from './drawingTypes';

export function generateDxf(loops: Point2[][]): string {
  return generateAnnotatedDxf(loops, {
    dimensions: [],
    texts: [],
    hatchEnabled: false,
  });
}

export function generateAnnotatedDxf(
  loops: Point2[][],
  annotations: DrawingAnnotations
): string {
  const d = new Drawing();
  d.setUnits('Millimeters');

  d.addLayer('OUTLINE', Drawing.ACI.WHITE, 'CONTINUOUS');
  d.addLayer('HATCH', Drawing.ACI.CYAN, 'CONTINUOUS');
  d.addLayer('DIMENSION', Drawing.ACI.YELLOW, 'CONTINUOUS');
  d.addLayer('TEXT', Drawing.ACI.GREEN, 'CONTINUOUS');

  d.setActiveLayer('OUTLINE');
  drawLoops(d, loops);

  if (annotations.hatchEnabled) {
    d.setActiveLayer('HATCH');
    const hatchLines = generateHatchLines(loops, {
      spacing: annotations.hatchSpacing,
      angleDeg: annotations.hatchAngleDeg,
    });
    for (const line of hatchLines) {
      d.drawLine(line.start[0], line.start[1], line.end[0], line.end[1]);
    }
  }

  d.setActiveLayer('DIMENSION');
  for (const dim of annotations.dimensions) {
    drawDimensionEnt(d, dim);
  }

  d.setActiveLayer('TEXT');
  const box = boundingBox(loops);
  const defaultHeight = Math.max(box.diagonal * 0.025, 1.5);
  for (const text of annotations.texts) {
    drawTextAnnotation(d, text, defaultHeight);
  }

  return d.toDxfString();
}

function drawLoops(d: Drawing, loops: Point2[][]): void {
  for (const loop of loops) {
    if (loop.length < 2) continue;
    const segments = detectSegments(loop);
    for (const seg of segments) {
      if (seg.type === 'arc') {
        if (seg.isFullCircle) {
          d.drawCircle(seg.center.x, seg.center.y, seg.radius);
        } else {
          const [startAngle, endAngle] = seg.clockwise
            ? [seg.endAngle, seg.startAngle]
            : [seg.startAngle, seg.endAngle];
          d.drawArc(seg.center.x, seg.center.y, seg.radius, startAngle, endAngle);
        }
      } else {
        d.drawLine(seg.start.x, seg.start.y, seg.end.x, seg.end.y);
      }
    }
  }
}

function drawDimensionEnt(d: Drawing, dim: DimensionAnnotation): void {
  if (dim.kind === 'diameter') {
    drawDiameterEnt(d, dim);
    return;
  }
  drawLinearEnt(d, dim);
}

function drawLinearEnt(d: Drawing, dim: LinearDimension): void {
  const { p1, p2, offset } = dim;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const d1: Point2 = [p1[0] + nx * offset, p1[1] + ny * offset];
  const d2: Point2 = [p2[0] + nx * offset, p2[1] + ny * offset];
  const ext = Math.sign(offset || 1) * Math.max(Math.abs(offset) * 0.1, 1);
  const e1: Point2 = [p1[0] + nx * (offset + ext), p1[1] + ny * (offset + ext)];
  const e2: Point2 = [p2[0] + nx * (offset + ext), p2[1] + ny * (offset + ext)];

  d.drawLine(p1[0], p1[1], e1[0], e1[1]);
  d.drawLine(p2[0], p2[1], e2[0], e2[1]);
  d.drawLine(d1[0], d1[1], d2[0], d2[1]);

  const tick = Math.max(Math.abs(offset) * 0.15, 0.8);
  d.drawLine(d1[0] - nx * tick, d1[1] - ny * tick, d1[0] + nx * tick, d1[1] + ny * tick);
  d.drawLine(d2[0] - nx * tick, d2[1] - ny * tick, d2[0] + nx * tick, d2[1] + ny * tick);

  const midX = (d1[0] + d2[0]) / 2;
  const midY = (d1[1] + d2[1]) / 2;
  const height = Math.max(Math.abs(offset) * 0.35, 1.2);
  const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  d.drawText(midX, midY, height, angleDeg, formatLength(len), 'center', 'bottom');
}

function drawDiameterEnt(d: Drawing, dim: DiameterDimension): void {
  const { center, radius, angle } = dim;
  if (radius < 1e-9) return;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const p1: Point2 = [center[0] - ux * radius, center[1] - uy * radius];
  const p2: Point2 = [center[0] + ux * radius, center[1] + uy * radius];

  d.drawLine(p1[0], p1[1], p2[0], p2[1]);

  const tick = Math.max(radius * 0.08, 0.6);
  const nx = -uy;
  const ny = ux;
  d.drawLine(p1[0] - nx * tick, p1[1] - ny * tick, p1[0] + nx * tick, p1[1] + ny * tick);
  d.drawLine(p2[0] - nx * tick, p2[1] - ny * tick, p2[0] + nx * tick, p2[1] + ny * tick);

  // center mark
  const mark = Math.max(radius * 0.12, 0.8);
  d.drawLine(center[0] - mark, center[1], center[0] + mark, center[1]);
  d.drawLine(center[0], center[1] - mark, center[0], center[1] + mark);

  const label = `⌀${formatLength(radius * 2)}`;
  const height = Math.max(radius * 0.25, 1.2);
  const labelOffset = Math.max(radius * 0.2, 1.5);
  const lx = center[0] + nx * labelOffset;
  const ly = center[1] + ny * labelOffset;
  const angleDeg = (angle * 180) / Math.PI;
  d.drawText(lx, ly, height, angleDeg, label, 'center', 'bottom');
}

function drawTextAnnotation(
  d: Drawing,
  text: TextAnnotation,
  fallbackHeight: number
): void {
  d.drawText(
    text.position[0],
    text.position[1],
    text.height || fallbackHeight,
    0,
    text.content,
    'left',
    'bottom'
  );
}

export function downloadDxf(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
