import type { OcctResult, SelectedFace } from './types';
import { loadStepFile } from './stepLoader';
import { extractFaceLoops2D } from './silhouette';
import { generateDxf, downloadDxf } from './dxfExporter';
import { Viewer } from './viewer';

export class App {
  private result: OcctResult | null = null;
  private selectedFace: SelectedFace | null = null;
  private viewer: Viewer;
  private statusEl: HTMLElement;
  private exportBtn: HTMLButtonElement;

  constructor(
    viewer: Viewer,
    statusEl: HTMLElement,
    exportBtn: HTMLButtonElement
  ) {
    this.viewer = viewer;
    this.statusEl = statusEl;
    this.exportBtn = exportBtn;

    this.viewer.onFaceClick((selection) => {
      this.handleFaceSelection(selection);
    });
  }

  async handleFile(file: File): Promise<void> {
    this.setStatus('STEP ファイルを読み込み中...');
    this.exportBtn.disabled = true;
    this.selectedFace = null;

    try {
      this.result = await loadStepFile(file);
      this.viewer.loadModel(this.result);
      this.setStatus(`読み込み完了: ${this.result.meshes.length} メッシュ`);
    } catch (err) {
      this.result = null;
      this.viewer.clearHighlight();
      const message = err instanceof Error ? err.message : '不明なエラー';
      this.setStatus(`エラー: ${message}`);
    }
  }

  handleFaceSelection(selection: SelectedFace | null): void {
    this.selectedFace = selection;
    if (selection) {
      this.exportBtn.disabled = false;
      this.setStatus(`面を選択: mesh ${selection.meshIndex}, face ${selection.faceIndex}`);
    } else {
      this.exportBtn.disabled = true;
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
      downloadDxf(dxf, 'selected-face.dxf');
      this.setStatus('DXF をダウンロードしました');
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラー';
      this.setStatus(`DXF 出力エラー: ${message}`);
    }
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
