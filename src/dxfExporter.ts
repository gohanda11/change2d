import Drawing from 'dxf-writer';
import { detectSegments } from './arcDetector';

export function generateDxf(loops: [number, number][][]): string {
  const d = new Drawing();
  d.setUnits('Millimeters');
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
  return d.toDxfString();
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
