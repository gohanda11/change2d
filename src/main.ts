import './style.css';
import { Viewer } from './viewer';
import { App } from './app';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;
const container = document.getElementById('viewer-container') as HTMLElement;

const viewer = new Viewer(container);
const app = new App(viewer, statusEl, exportBtn);

fileInput.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  app.handleFile(file);
});

exportBtn.addEventListener('click', () => {
  app.exportSelectedFace();
});
