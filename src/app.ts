import type { OcctResult, SelectedFace } from './types';
import { loadStepFile } from './stepLoader';
import { extractFaceLoops2D } from './silhouette';
import { generateDxf, downloadDxf } from './dxfExporter';
import { Viewer } from './viewer';
import { DrawingEditor } from './drawingEditor';

export class App {
  private result: OcctResult | null = null;
  private selectedFace: SelectedFace | null = null;
  private currentFileName: string | null = null;
  private viewer: Viewer;
  private statusEl: HTMLElement;
  private exportBtn: HTMLButtonElement;
  private drawingBtn: HTMLButtonElement;
  private drawingEditor: DrawingEditor;

  constructor(
    viewer: Viewer,
    statusEl: HTMLElement,
    exportBtn: HTMLButtonElement,
    drawingBtn: HTMLButtonElement,
    drawingEditor: DrawingEditor
  ) {
    this.viewer = viewer;
    this.statusEl = statusEl;
    this.exportBtn = exportBtn;
    this.drawingBtn = drawingBtn;
    this.drawingEditor = drawingEditor;

    this.viewer.onFaceClick((selection) => {
      this.handleFaceSelection(selection);
    });
  }

  async handleFile(file: File): Promise<void> {
    this.setStatus('STEP ファイルを読み込み中...');
    this.setFaceActionsEnabled(false);
    this.selectedFace = null;
    this.currentFileName = file.name;
    if (this.drawingEditor.isOpen()) this.drawingEditor.close();

    try {
      this.result = await loadStepFile(file);
      this.viewer.loadModel(this.result);
      this.setStatus(`読み込み完了: ${this.result.meshes.length} メッシュ`);
    } catch (err) {
      this.result = null;
      this.currentFileName = null;
      this.viewer.clearHighlight();
      const message = err instanceof Error ? err.message : '不明なエラー';
      this.setStatus(`エラー: ${message}`);
    }
  }

  handleFaceSelection(selection: (SelectedFace & { triangleCount: number }) | null): void {
    this.selectedFace = selection;
    if (selection) {
      this.setFaceActionsEnabled(true);
      this.setStatus(
        `面を選択: mesh ${selection.meshIndex}, face ${selection.faceIndex} (${selection.triangleCount.toLocaleString()} 三角形)`
      );
    } else {
      this.setFaceActionsEnabled(false);
      this.setStatus('面が選択されていません');
    }
  }

  exportSelectedFace(): void {
    if (!this.result || !this.selectedFace) return;

    const mesh = this.result.meshes[this.selectedFace.meshIndex];
    const face = mesh.brep_faces[this.selectedFace.faceIndex];

    try {
      const { loops } = extractFaceLoops2D(mesh, face);
      if (loops.length === 0) {
        this.setStatus('選択された面から輪郭を抽出できませんでした');
        return;
      }
      const dxf = generateDxf(loops);
      const baseName = this.getBaseName();
      downloadDxf(dxf, `${baseName}.dxf`);
      this.setStatus('DXF をダウンロードしました');
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラー';
      this.setStatus(`DXF 出力エラー: ${message}`);
    }
  }

  openDrawingEditor(): void {
    if (!this.result || !this.selectedFace) return;

    const mesh = this.result.meshes[this.selectedFace.meshIndex];
    const face = mesh.brep_faces[this.selectedFace.faceIndex];

    try {
      const { loops } = extractFaceLoops2D(mesh, face);
      if (loops.length === 0) {
        this.setStatus('選択された面から輪郭を抽出できませんでした');
        return;
      }
      this.drawingEditor.open(loops, this.getBaseName());
      this.setStatus('2D図面編集を開きました');
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラー';
      this.setStatus(`2D図面エラー: ${message}`);
    }
  }

  private getBaseName(): string {
    return (
      this.currentFileName?.replace(/\.step$/i, '').replace(/\.stp$/i, '') ??
      'selected-face'
    );
  }

  private setFaceActionsEnabled(enabled: boolean): void {
    this.exportBtn.disabled = !enabled;
    this.drawingBtn.disabled = !enabled;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
