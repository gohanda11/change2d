import {
  boundingBox,
  distance,
  formatLength,
  type Point2,
} from './geometry2d';
import { generateHatchLines } from './hatch';
import { downloadAnnotatedPdf } from './pdfExporter';
import {
  collectCircles,
  collectCornerPoints,
  findNearestCircle,
  snapToPoints,
} from './drawingSnap';
import type {
  CircleFeature,
  DiameterDimension,
  DimensionAnnotation,
  DrawingAnnotations,
  DrawingTool,
  LinearDimension,
  TextAnnotation,
} from './drawingTypes';

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export class DrawingEditor {
  private modal: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hintEl: HTMLElement;
  private toolButtons: Record<DrawingTool, HTMLButtonElement>;
  private hatchBtn: HTMLButtonElement;

  private loops: Point2[][] = [];
  private corners: Point2[] = [];
  private circles: CircleFeature[] = [];
  private fileBaseName = 'selected-face';
  private annotations: DrawingAnnotations = {
    dimensions: [],
    texts: [],
    hatchEnabled: false,
  };

  private tool: DrawingTool = 'dimension';
  private transform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private pendingDimStart: Point2 | null = null;
  private hoverPoint: Point2 | null = null;
  private snapPoint: Point2 | null = null;
  private hoverCircle: CircleFeature | null = null;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private hatchCache: { start: Point2; end: Point2 }[] = [];

  private draggingTextIndex: number | null = null;
  private textDragOffset: Point2 = [0, 0];

  constructor(modal: HTMLElement) {
    this.modal = modal;
    this.canvas = modal.querySelector('#drawing-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas が使えません');
    this.ctx = ctx;
    this.hintEl = modal.querySelector('#drawing-hint') as HTMLElement;

    this.toolButtons = {
      pan: modal.querySelector('[data-tool="pan"]') as HTMLButtonElement,
      dimension: modal.querySelector('[data-tool="dimension"]') as HTMLButtonElement,
      diameter: modal.querySelector('[data-tool="diameter"]') as HTMLButtonElement,
      text: modal.querySelector('[data-tool="text"]') as HTMLButtonElement,
    };
    this.hatchBtn = modal.querySelector('#drawing-hatch-btn') as HTMLButtonElement;

    this.bindUi();
    this.bindCanvas();
  }

  open(loops: Point2[][], fileBaseName: string): void {
    this.loops = loops;
    this.corners = collectCornerPoints(loops);
    this.circles = collectCircles(loops);
    this.fileBaseName = fileBaseName;
    this.annotations = {
      dimensions: [],
      texts: [],
      hatchEnabled: false,
    };
    this.pendingDimStart = null;
    this.hoverPoint = null;
    this.snapPoint = null;
    this.hoverCircle = null;
    this.draggingTextIndex = null;
    this.hatchCache = [];
    this.hatchBtn.classList.remove('active');
    this.hatchBtn.textContent = '斜線: OFF';
    this.setTool('dimension');
    this.modal.classList.remove('hidden');
    this.resizeCanvas();
    this.fitToView();
    this.redraw();
    this.updateHint();
  }

  close(): void {
    this.modal.classList.add('hidden');
    this.pendingDimStart = null;
    this.hoverPoint = null;
    this.snapPoint = null;
    this.hoverCircle = null;
    this.draggingTextIndex = null;
  }

  isOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }

  private bindUi(): void {
    for (const [tool, btn] of Object.entries(this.toolButtons) as [
      DrawingTool,
      HTMLButtonElement,
    ][]) {
      btn.addEventListener('click', () => this.setTool(tool));
    }

    this.hatchBtn.addEventListener('click', () => {
      this.annotations.hatchEnabled = !this.annotations.hatchEnabled;
      this.hatchBtn.classList.toggle('active', this.annotations.hatchEnabled);
      this.hatchBtn.textContent = this.annotations.hatchEnabled ? '斜線: ON' : '斜線: OFF';
      if (this.annotations.hatchEnabled) {
        this.hatchCache = generateHatchLines(this.loops);
      } else {
        this.hatchCache = [];
      }
      this.redraw();
    });

    this.modal.querySelector('#drawing-clear-btn')!.addEventListener('click', () => {
      this.annotations.dimensions = [];
      this.annotations.texts = [];
      this.pendingDimStart = null;
      this.draggingTextIndex = null;
      this.redraw();
      this.updateHint('注釈をクリアしました');
    });

    this.modal.querySelector('#drawing-save-btn')!.addEventListener('click', () => {
      downloadAnnotatedPdf(this.loops, this.annotations, `${this.fileBaseName}-drawing.pdf`);
      this.updateHint('PDF をダウンロードしました');
    });

    this.modal.querySelector('#drawing-close-btn')!.addEventListener('click', () => {
      this.close();
    });

    window.addEventListener('resize', () => {
      if (!this.isOpen()) return;
      this.resizeCanvas();
      this.redraw();
    });
  }

  private bindCanvas(): void {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverPoint = null;
      this.snapPoint = null;
      this.hoverCircle = null;
      this.isPanning = false;
      this.draggingTextIndex = null;
      this.redraw();
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private setTool(tool: DrawingTool): void {
    this.tool = tool;
    this.pendingDimStart = null;
    this.draggingTextIndex = null;
    this.snapPoint = null;
    this.hoverCircle = null;
    for (const [name, btn] of Object.entries(this.toolButtons) as [
      DrawingTool,
      HTMLButtonElement,
    ][]) {
      btn.classList.toggle('active', name === tool);
    }
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    this.updateHint();
    this.redraw();
  }

  private updateHint(extra?: string): void {
    if (extra) {
      this.hintEl.textContent = extra;
      return;
    }
    if (this.tool === 'pan') {
      this.hintEl.textContent = 'ドラッグでパン、ホイールでズーム';
    } else if (this.tool === 'dimension') {
      this.hintEl.textContent = this.pendingDimStart
        ? '終点をクリック（角にスナップします）'
        : '始点をクリック（角・端点にスナップ）';
    } else if (this.tool === 'diameter') {
      this.hintEl.textContent = '円／穴をクリック（中心にスナップして直径寸法）';
    } else {
      this.hintEl.textContent = '空クリックで追加 / 既存テキストをドラッグで移動';
    }
  }

  private snapThresholdModel(): number {
    return Math.max(8 / this.transform.scale, 0.2);
  }

  private resolveSnap(model: Point2): Point2 {
    if (this.tool === 'dimension') {
      const snapped = snapToPoints(model, this.corners, this.snapThresholdModel());
      this.snapPoint = snapped;
      return snapped ?? model;
    }
    this.snapPoint = null;
    return model;
  }

  private resolveHoverCircle(model: Point2): CircleFeature | null {
    if (this.tool !== 'diameter') {
      this.hoverCircle = null;
      return null;
    }
    const threshold = Math.max(this.snapThresholdModel(), boundingBox(this.loops).diagonal * 0.02);
    this.hoverCircle = findNearestCircle(model, this.circles, threshold);
    return this.hoverCircle;
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement!;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private fitToView(): void {
    const box = boundingBox(this.loops);
    const cssWidth = this.canvas.clientWidth || 800;
    const cssHeight = this.canvas.clientHeight || 600;
    const padding = 48;
    const scaleX = (cssWidth - padding * 2) / Math.max(box.width, 1e-6);
    const scaleY = (cssHeight - padding * 2) / Math.max(box.height, 1e-6);
    const scale = Math.min(scaleX, scaleY);
    this.transform.scale = scale;
    this.transform.offsetX = cssWidth / 2 - ((box.minX + box.maxX) / 2) * scale;
    this.transform.offsetY = cssHeight / 2 + ((box.minY + box.maxY) / 2) * scale;
  }

  private modelToScreen(p: Point2): Point2 {
    return [
      p[0] * this.transform.scale + this.transform.offsetX,
      -p[1] * this.transform.scale + this.transform.offsetY,
    ];
  }

  private screenToModel(p: Point2): Point2 {
    return [
      (p[0] - this.transform.offsetX) / this.transform.scale,
      -(p[1] - this.transform.offsetY) / this.transform.scale,
    ];
  }

  private eventToScreen(e: PointerEvent): Point2 {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private hitTestText(screen: Point2): number {
    for (let i = this.annotations.texts.length - 1; i >= 0; i--) {
      const text = this.annotations.texts[i];
      const p = this.modelToScreen(text.position);
      const screenHeight = Math.max(10, text.height * this.transform.scale);
      this.ctx.font = `${screenHeight}px Inter, system-ui, sans-serif`;
      const width = this.ctx.measureText(text.content).width;
      const pad = 6;
      if (
        screen[0] >= p[0] - pad &&
        screen[0] <= p[0] + width + pad &&
        screen[1] <= p[1] + pad &&
        screen[1] >= p[1] - screenHeight - pad
      ) {
        return i;
      }
    }
    return -1;
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const screen = this.eventToScreen(e);
    const rawModel = this.screenToModel(screen);

    if (this.tool === 'pan' || e.button === 1 || e.shiftKey) {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this.tool === 'text') {
      const hit = this.hitTestText(screen);
      if (hit >= 0) {
        const text = this.annotations.texts[hit];
        this.draggingTextIndex = hit;
        this.textDragOffset = [text.position[0] - rawModel[0], text.position[1] - rawModel[1]];
        this.canvas.style.cursor = 'move';
        this.updateHint('テキストをドラッグ中…');
        return;
      }
      const content = window.prompt('配置するテキストを入力してください');
      if (content && content.trim()) {
        const box = boundingBox(this.loops);
        const height = Math.max(box.diagonal * 0.025, 1.5);
        const text: TextAnnotation = {
          position: rawModel,
          content: content.trim(),
          height,
        };
        this.annotations.texts.push(text);
        this.redraw();
        this.updateHint('追加後、ドラッグで位置を変えられます');
      }
      return;
    }

    if (this.tool === 'dimension') {
      const model = this.resolveSnap(rawModel);
      if (!this.pendingDimStart) {
        this.pendingDimStart = model;
        this.updateHint();
      } else {
        const p1 = this.pendingDimStart;
        const p2 = model;
        if (distance(p1, p2) > 1e-6) {
          const box = boundingBox(this.loops);
          const offset = Math.max(box.diagonal * 0.06, 3);
          const dim: LinearDimension = { kind: 'linear', p1, p2, offset };
          this.annotations.dimensions.push(dim);
        }
        this.pendingDimStart = null;
        this.updateHint();
      }
      this.redraw();
      return;
    }

    if (this.tool === 'diameter') {
      const circle = this.resolveHoverCircle(rawModel);
      if (!circle) {
        this.updateHint('円が見つかりません。円／穴の近くをクリックしてください');
        return;
      }
      const dx = rawModel[0] - circle.center[0];
      const dy = rawModel[1] - circle.center[1];
      const angle = Math.hypot(dx, dy) > 1e-8 ? Math.atan2(dy, dx) : 0;
      const dim: DiameterDimension = {
        kind: 'diameter',
        center: circle.center,
        radius: circle.radius,
        angle,
      };
      this.annotations.dimensions.push(dim);
      this.updateHint(`直径 ⌀${formatLength(circle.radius * 2)} を追加しました`);
      this.redraw();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.isPanning) {
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.transform.offsetX += dx;
      this.transform.offsetY += dy;
      this.redraw();
      return;
    }

    const screen = this.eventToScreen(e);
    const rawModel = this.screenToModel(screen);

    if (this.draggingTextIndex !== null) {
      const text = this.annotations.texts[this.draggingTextIndex];
      text.position = [
        rawModel[0] + this.textDragOffset[0],
        rawModel[1] + this.textDragOffset[1],
      ];
      this.redraw();
      return;
    }

    this.hoverPoint = this.resolveSnap(rawModel);
    this.resolveHoverCircle(rawModel);

    if (this.tool === 'text') {
      this.canvas.style.cursor = this.hitTestText(screen) >= 0 ? 'move' : 'crosshair';
    }

    if (
      (this.tool === 'dimension' && this.pendingDimStart) ||
      this.tool === 'dimension' ||
      this.tool === 'diameter'
    ) {
      this.redraw();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : 'crosshair';
    }
    if (this.draggingTextIndex !== null) {
      this.draggingTextIndex = null;
      this.canvas.style.cursor = 'crosshair';
      this.updateHint();
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const screen = (() => {
      const rect = this.canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top] as Point2;
    })();
    const before = this.screenToModel(screen);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.transform.scale = Math.min(500, Math.max(0.05, this.transform.scale * factor));
    const afterScreen = this.modelToScreen(before);
    this.transform.offsetX += screen[0] - afterScreen[0];
    this.transform.offsetY += screen[1] - afterScreen[1];
    this.redraw();
  }

  private redraw(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = '#111';
    this.ctx.fillRect(0, 0, w, h);

    if (this.annotations.hatchEnabled) {
      this.ctx.strokeStyle = '#6b7280';
      this.ctx.lineWidth = 1;
      for (const line of this.hatchCache) {
        const s = this.modelToScreen(line.start);
        const e = this.modelToScreen(line.end);
        this.ctx.beginPath();
        this.ctx.moveTo(s[0], s[1]);
        this.ctx.lineTo(e[0], e[1]);
        this.ctx.stroke();
      }
    }

    this.ctx.strokeStyle = '#e5e5e5';
    this.ctx.lineWidth = 1.5;
    for (const loop of this.loops) {
      if (loop.length < 2) continue;
      const first = this.modelToScreen(loop[0]);
      this.ctx.beginPath();
      this.ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < loop.length; i++) {
        const p = this.modelToScreen(loop[i]);
        this.ctx.lineTo(p[0], p[1]);
      }
      this.ctx.closePath();
      this.ctx.stroke();
    }

    // corner guides while dimensioning
    if (this.tool === 'dimension') {
      this.ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      for (const c of this.corners) {
        const s = this.modelToScreen(c);
        this.ctx.beginPath();
        this.ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // circle guides while diameter tool
    if (this.tool === 'diameter') {
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      this.ctx.lineWidth = 1;
      for (const c of this.circles) {
        const center = this.modelToScreen(c.center);
        const r = c.radius * this.transform.scale;
        this.ctx.beginPath();
        this.ctx.arc(center[0], center[1], r, 0, Math.PI * 2);
        this.ctx.stroke();
        this.drawCross(center, 6, '#38bdf8');
      }
    }

    for (const dim of this.annotations.dimensions) {
      this.drawDimension(dim);
    }

    if (this.tool === 'dimension' && this.pendingDimStart && this.hoverPoint) {
      this.drawDimension(
        {
          kind: 'linear',
          p1: this.pendingDimStart,
          p2: this.hoverPoint,
          offset: Math.max(boundingBox(this.loops).diagonal * 0.06, 3),
        },
        true
      );
    }

    if (this.tool === 'diameter' && this.hoverCircle && this.hoverPoint) {
      const dx = this.hoverPoint[0] - this.hoverCircle.center[0];
      const dy = this.hoverPoint[1] - this.hoverCircle.center[1];
      const angle = Math.hypot(dx, dy) > 1e-8 ? Math.atan2(dy, dx) : 0;
      this.drawDimension(
        {
          kind: 'diameter',
          center: this.hoverCircle.center,
          radius: this.hoverCircle.radius,
          angle,
        },
        true
      );
    }

    for (const text of this.annotations.texts) {
      this.drawText(text);
    }

    if (this.snapPoint) {
      const s = this.modelToScreen(this.snapPoint);
      this.ctx.strokeStyle = '#38bdf8';
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeRect(s[0] - 5, s[1] - 5, 10, 10);
    }

    if (this.pendingDimStart) {
      const s = this.modelToScreen(this.pendingDimStart);
      this.ctx.fillStyle = '#38bdf8';
      this.ctx.beginPath();
      this.ctx.arc(s[0], s[1], 4, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawCross(center: Point2, size: number, color: string): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(center[0] - size, center[1]);
    this.ctx.lineTo(center[0] + size, center[1]);
    this.ctx.moveTo(center[0], center[1] - size);
    this.ctx.lineTo(center[0], center[1] + size);
    this.ctx.stroke();
  }

  private drawDimension(dim: DimensionAnnotation, preview = false): void {
    if (dim.kind === 'diameter') {
      this.drawDiameter(dim, preview);
      return;
    }
    this.drawLinear(dim, preview);
  }

  private drawLinear(dim: LinearDimension, preview = false): void {
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

    const s1 = this.modelToScreen(p1);
    const s2 = this.modelToScreen(p2);
    const sd1 = this.modelToScreen(d1);
    const sd2 = this.modelToScreen(d2);
    const se1 = this.modelToScreen(e1);
    const se2 = this.modelToScreen(e2);

    this.ctx.strokeStyle = preview ? '#38bdf8' : '#fbbf24';
    this.ctx.fillStyle = preview ? '#38bdf8' : '#fbbf24';
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();
    this.ctx.moveTo(s1[0], s1[1]);
    this.ctx.lineTo(se1[0], se1[1]);
    this.ctx.moveTo(s2[0], s2[1]);
    this.ctx.lineTo(se2[0], se2[1]);
    this.ctx.moveTo(sd1[0], sd1[1]);
    this.ctx.lineTo(sd2[0], sd2[1]);
    this.ctx.stroke();

    const tick = 6;
    this.drawTick(sd1, ux, uy, tick);
    this.drawTick(sd2, ux, uy, tick);

    const mid: Point2 = [(sd1[0] + sd2[0]) / 2, (sd1[1] + sd2[1]) / 2];
    const label = formatLength(len);
    this.ctx.font = '12px Inter, system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(label, mid[0], mid[1] - 4);
  }

  private drawDiameter(dim: DiameterDimension, preview = false): void {
    const { center, radius, angle } = dim;
    if (radius < 1e-9) return;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const p1: Point2 = [center[0] - ux * radius, center[1] - uy * radius];
    const p2: Point2 = [center[0] + ux * radius, center[1] + uy * radius];
    const s1 = this.modelToScreen(p1);
    const s2 = this.modelToScreen(p2);
    const sc = this.modelToScreen(center);

    this.ctx.strokeStyle = preview ? '#38bdf8' : '#fbbf24';
    this.ctx.fillStyle = preview ? '#38bdf8' : '#fbbf24';
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();
    this.ctx.moveTo(s1[0], s1[1]);
    this.ctx.lineTo(s2[0], s2[1]);
    this.ctx.stroke();

    this.drawTick(s1, ux, uy, 6);
    this.drawTick(s2, ux, uy, 6);
    this.drawCross(sc, 5, preview ? '#38bdf8' : '#fbbf24');

    const nx = -uy;
    const ny = ux;
    const labelPos = this.modelToScreen([
      center[0] + nx * Math.max(radius * 0.2, 1.5),
      center[1] + ny * Math.max(radius * 0.2, 1.5),
    ]);
    this.ctx.font = '12px Inter, system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(`⌀${formatLength(radius * 2)}`, labelPos[0], labelPos[1] - 2);
  }

  private drawTick(center: Point2, ux: number, uy: number, size: number): void {
    const nx = -uy;
    const ny = ux;
    this.ctx.beginPath();
    this.ctx.moveTo(center[0] - nx * size, center[1] - ny * size);
    this.ctx.lineTo(center[0] + nx * size, center[1] + ny * size);
    this.ctx.stroke();
  }

  private drawText(text: TextAnnotation): void {
    const p = this.modelToScreen(text.position);
    const screenHeight = Math.max(10, text.height * this.transform.scale);
    this.ctx.font = `${screenHeight}px Inter, system-ui, sans-serif`;
    const width = this.ctx.measureText(text.content).width;
    this.ctx.fillStyle = 'rgba(134, 239, 172, 0.12)';
    this.ctx.fillRect(p[0] - 2, p[1] - screenHeight - 2, width + 4, screenHeight + 4);
    this.ctx.fillStyle = '#86efac';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(text.content, p[0], p[1]);
  }
}
