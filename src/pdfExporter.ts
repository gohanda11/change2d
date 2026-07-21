import { jsPDF } from 'jspdf';
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

const PAGE_WIDTH = 297; // A4 landscape mm
const PAGE_HEIGHT = 210;
const MARGIN = 12;

interface PdfTransform {
  scale: number;
  offsetX: number;
  offsetY: number; // model origin mapped so +Y goes up on page
}

export function generateAnnotatedPdf(
  loops: Point2[][],
  annotations: DrawingAnnotations
): ArrayBuffer {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const box = boundingBox(loops);
  // include annotations roughly in bounds
  const padded = expandBoxForAnnotations(box, annotations);
  const transform = fitToPage(padded);

  // white background already; draw content in dark lines for print
  drawHatch(doc, loops, annotations, transform);
  drawLoops(doc, loops, transform);

  for (const dim of annotations.dimensions) {
    drawDimension(doc, dim, transform);
  }

  const defaultHeight = Math.max(padded.diagonal * 0.025, 1.5);
  for (const text of annotations.texts) {
    drawTextAnnotation(doc, text, defaultHeight, transform);
  }

  return doc.output('arraybuffer');
}

export function downloadAnnotatedPdf(
  loops: Point2[][],
  annotations: DrawingAnnotations,
  filename: string
): void {
  const buffer = generateAnnotatedPdf(loops, annotations);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function expandBoxForAnnotations(
  box: ReturnType<typeof boundingBox>,
  annotations: DrawingAnnotations
) {
  let { minX, minY, maxX, maxY } = box;

  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const dim of annotations.dimensions) {
    if (dim.kind === 'diameter') {
      const ux = Math.cos(dim.angle);
      const uy = Math.sin(dim.angle);
      grow(dim.center[0] - ux * dim.radius, dim.center[1] - uy * dim.radius);
      grow(dim.center[0] + ux * dim.radius, dim.center[1] + uy * dim.radius);
      const nx = -uy;
      const ny = ux;
      const labelOffset = Math.max(dim.radius * 0.2, 1.5);
      grow(dim.center[0] + nx * labelOffset, dim.center[1] + ny * labelOffset);
    } else {
      const dx = dim.p2[0] - dim.p1[0];
      const dy = dim.p2[1] - dim.p1[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      grow(dim.p1[0] + nx * dim.offset, dim.p1[1] + ny * dim.offset);
      grow(dim.p2[0] + nx * dim.offset, dim.p2[1] + ny * dim.offset);
      grow(dim.p1[0], dim.p1[1]);
      grow(dim.p2[0], dim.p2[1]);
    }
  }

  for (const text of annotations.texts) {
    grow(text.position[0], text.position[1]);
    grow(text.position[0] + text.content.length * text.height * 0.6, text.position[1] + text.height);
  }

  const pad = Math.max((maxX - minX), (maxY - minY), 1) * 0.08;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
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

function fitToPage(box: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}): PdfTransform {
  const availW = PAGE_WIDTH - MARGIN * 2;
  const availH = PAGE_HEIGHT - MARGIN * 2;
  const scale = Math.min(availW / Math.max(box.width, 1e-6), availH / Math.max(box.height, 1e-6));
  const drawnW = box.width * scale;
  const drawnH = box.height * scale;
  const offsetX = MARGIN + (availW - drawnW) / 2 - box.minX * scale;
  // PDF Y grows downward; map model Y-up so maxY sits near top margin area
  const offsetY = MARGIN + (availH - drawnH) / 2 + box.maxY * scale;
  return { scale, offsetX, offsetY };
}

function toPage(p: Point2, t: PdfTransform): Point2 {
  return [p[0] * t.scale + t.offsetX, -p[1] * t.scale + t.offsetY];
}

function line(doc: jsPDF, a: Point2, b: Point2, t: PdfTransform, color: [number, number, number] = [20, 20, 20]): void {
  const p1 = toPage(a, t);
  const p2 = toPage(b, t);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.line(p1[0], p1[1], p2[0], p2[1]);
}

function drawLoops(doc: jsPDF, loops: Point2[][], t: PdfTransform): void {
  doc.setLineWidth(0.25);
  doc.setDrawColor(20, 20, 20);
  for (const loop of loops) {
    if (loop.length < 2) continue;
    const segments = detectSegments(loop);
    for (const seg of segments) {
      if (seg.type === 'arc') {
        const c = toPage([seg.center.x, seg.center.y], t);
        const r = seg.radius * t.scale;
        if (seg.isFullCircle) {
          doc.circle(c[0], c[1], r);
        } else {
          // DXF と同じくモデル座標では CCW スイープに正規化
          const modelStart = seg.clockwise ? seg.endAngle : seg.startAngle;
          const modelEnd = seg.clockwise ? seg.startAngle : seg.endAngle;
          // toPage は Y 反転するので、モデル CCW 弧 a→b の像は
          // ページ角 -b → -a の増加スイープ（短い方）になる
          drawArcOnPage(doc, c[0], c[1], r, -modelEnd, -modelStart);
        }
      } else {
        line(doc, [seg.start.x, seg.start.y], [seg.end.x, seg.end.y], t);
      }
    }
  }
}

/**
 * ページ座標で startDeg→endDeg へ角度増加方向に弧を描く。
 * ページは Y 下向きなので、この増加は画面上では時計回りに見える。
 */
function drawArcOnPage(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): void {
  const start = ((startDeg % 360) + 360) % 360;
  let end = ((endDeg % 360) + 360) % 360;
  let sweep = end - start;
  if (sweep <= 0) sweep += 360;
  const steps = Math.max(12, Math.ceil(sweep / 3));
  let prevX = cx + r * Math.cos((start * Math.PI) / 180);
  let prevY = cy + r * Math.sin((start * Math.PI) / 180);
  for (let i = 1; i <= steps; i++) {
    const ang = start + (sweep * i) / steps;
    const x = cx + r * Math.cos((ang * Math.PI) / 180);
    const y = cy + r * Math.sin((ang * Math.PI) / 180);
    doc.line(prevX, prevY, x, y);
    prevX = x;
    prevY = y;
  }
}

/** テスト用: Y反転後に描くべきページ角スイープを返す */
export function pageArcSweepDegrees(
  startAngle: number,
  endAngle: number,
  clockwise: boolean
): { start: number; end: number; sweep: number } {
  const modelStart = clockwise ? endAngle : startAngle;
  const modelEnd = clockwise ? startAngle : endAngle;
  const start = (((-modelEnd) % 360) + 360) % 360;
  let end = (((-modelStart) % 360) + 360) % 360;
  let sweep = end - start;
  if (sweep <= 0) sweep += 360;
  return { start, end, sweep };
}

function drawHatch(
  doc: jsPDF,
  loops: Point2[][],
  annotations: DrawingAnnotations,
  t: PdfTransform
): void {
  if (!annotations.hatchEnabled) return;
  doc.setLineWidth(0.1);
  doc.setDrawColor(120, 120, 120);
  const hatchLines = generateHatchLines(loops, {
    spacing: annotations.hatchSpacing,
    angleDeg: annotations.hatchAngleDeg,
  });
  for (const h of hatchLines) {
    line(doc, h.start, h.end, t, [120, 120, 120]);
  }
}

function drawDimension(doc: jsPDF, dim: DimensionAnnotation, t: PdfTransform): void {
  doc.setLineWidth(0.18);
  doc.setDrawColor(30, 30, 30);
  doc.setTextColor(30, 30, 30);
  if (dim.kind === 'diameter') {
    drawDiameter(doc, dim, t);
  } else {
    drawLinear(doc, dim, t);
  }
}

function drawLinear(doc: jsPDF, dim: LinearDimension, t: PdfTransform): void {
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

  line(doc, p1, e1, t);
  line(doc, p2, e2, t);
  line(doc, d1, d2, t);

  const tick = Math.max(Math.abs(offset) * 0.15, 0.8);
  line(doc, [d1[0] - nx * tick, d1[1] - ny * tick], [d1[0] + nx * tick, d1[1] + ny * tick], t);
  line(doc, [d2[0] - nx * tick, d2[1] - ny * tick], [d2[0] + nx * tick, d2[1] + ny * tick], t);

  const mid: Point2 = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2];
  const height = Math.max(Math.abs(offset) * 0.35, 1.2);
  const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  drawModelText(doc, formatLength(len), mid, height, angleDeg, 'center', 'bottom', t);
}

function drawDiameter(doc: jsPDF, dim: DiameterDimension, t: PdfTransform): void {
  const { center, radius, angle } = dim;
  if (radius < 1e-9) return;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const p1: Point2 = [center[0] - ux * radius, center[1] - uy * radius];
  const p2: Point2 = [center[0] + ux * radius, center[1] + uy * radius];
  line(doc, p1, p2, t);

  const tick = Math.max(radius * 0.08, 0.6);
  const nx = -uy;
  const ny = ux;
  line(doc, [p1[0] - nx * tick, p1[1] - ny * tick], [p1[0] + nx * tick, p1[1] + ny * tick], t);
  line(doc, [p2[0] - nx * tick, p2[1] - ny * tick], [p2[0] + nx * tick, p2[1] + ny * tick], t);

  const mark = Math.max(radius * 0.12, 0.8);
  line(doc, [center[0] - mark, center[1]], [center[0] + mark, center[1]], t);
  line(doc, [center[0], center[1] - mark], [center[0], center[1] + mark], t);

  // Ø is Latin-1; ⌀ often missing in standard PDF fonts
  const label = `Ø${formatLength(radius * 2)}`;
  const height = Math.max(radius * 0.25, 1.2);
  const labelOffset = Math.max(radius * 0.2, 1.5);
  const lp: Point2 = [center[0] + nx * labelOffset, center[1] + ny * labelOffset];
  const angleDeg = (angle * 180) / Math.PI;
  drawModelText(doc, label, lp, height, angleDeg, 'center', 'bottom', t);
}

function drawTextAnnotation(
  doc: jsPDF,
  text: TextAnnotation,
  fallbackHeight: number,
  t: PdfTransform
): void {
  drawModelText(
    doc,
    text.content,
    text.position,
    text.height || fallbackHeight,
    0,
    'left',
    'bottom',
    t
  );
}

/** helvetica では日本語や ⌀ などが文字化けするため、非ASCIIは Canvas 経由で埋め込む */
function needsCanvasText(content: string): boolean {
  return /[^\x00-\x7F]/.test(content);
}

function drawModelText(
  doc: jsPDF,
  content: string,
  modelPos: Point2,
  modelHeight: number,
  angleDeg: number,
  align: 'left' | 'center' | 'right',
  baseline: 'bottom' | 'middle' | 'top',
  t: PdfTransform
): void {
  const p = toPage(modelPos, t);
  const pageAngle = -angleDeg;
  const heightMm = Math.max(modelHeight * t.scale, 2);

  if (typeof document !== 'undefined' && needsCanvasText(content)) {
    drawCanvasText(doc, content, p, heightMm, pageAngle, align, baseline);
    return;
  }

  const fontSizePt = Math.max(6, heightMm * 2.83465);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSizePt);
  doc.setTextColor(20, 20, 20);
  doc.text(content, p[0], p[1], {
    angle: pageAngle,
    align,
    baseline,
  });
}

function drawCanvasText(
  doc: jsPDF,
  content: string,
  pagePos: Point2,
  heightMm: number,
  pageAngleDeg: number,
  align: 'left' | 'center' | 'right',
  baseline: 'bottom' | 'middle' | 'top'
): void {
  const pxPerMm = 12;
  const fontPx = Math.max(16, heightMm * pxPerMm);
  const fontFamily =
    '"Segoe UI", "Yu Gothic UI", "Yu Gothic", Meiryo, "Hiragino Sans", "Noto Sans JP", sans-serif';

  const measure = document.createElement('canvas');
  const mctx = measure.getContext('2d');
  if (!mctx) return;
  mctx.font = `${fontPx}px ${fontFamily}`;
  const width = Math.max(1, mctx.measureText(content).width);
  const height = Math.max(1, fontPx * 1.35);

  let left = 0;
  let top = 0;
  if (align === 'center') left = -width / 2;
  else if (align === 'right') left = -width;
  if (baseline === 'bottom') top = -height;
  else if (baseline === 'middle') top = -height / 2;

  const rad = (pageAngleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: Point2[] = [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  const pad = 4;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const bbW = Math.max(1, Math.ceil(maxX - minX));
  const bbH = Math.max(1, Math.ceil(maxY - minY));

  const canvas = document.createElement('canvas');
  canvas.width = bbW;
  canvas.height = bbH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.translate(-minX, -minY);
  ctx.rotate(rad);
  ctx.font = `${fontPx}px ${fontFamily}`;
  ctx.fillStyle = '#141414';
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(content, 0, 0);

  const wMm = bbW / pxPerMm;
  const hMm = bbH / pxPerMm;
  const anchorXmm = -minX / pxPerMm;
  const anchorYmm = -minY / pxPerMm;
  const dataUrl = canvas.toDataURL('image/png');
  doc.addImage(
    dataUrl,
    'PNG',
    pagePos[0] - anchorXmm,
    pagePos[1] - anchorYmm,
    wMm,
    hMm
  );
}

/** テスト用に公開 */
export function needsCanvasTextForTest(content: string): boolean {
  return needsCanvasText(content);
}
