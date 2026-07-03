import Drawing from 'dxf-writer';

export function generateDxf(loops: [number, number][][]): string {
  const d = new Drawing();
  d.setUnits('Millimeters');
  for (const loop of loops) {
    if (loop.length < 2) continue;
    d.drawPolyline(loop, true);
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
