/** DXF 出力時のコンソールデバッグ */
let enabled = false;

export function setDxfDebug(on: boolean): void {
  enabled = on;
}

export function isDxfDebugEnabled(): boolean {
  return enabled;
}

export function dxfGroup(label: string): void {
  if (!enabled) return;
  console.group(label);
}

export function dxfGroupEnd(): void {
  if (!enabled) return;
  console.groupEnd();
}

export function dxfLog(...args: unknown[]): void {
  if (!enabled) return;
  console.log('[DXF]', ...args);
}

export function dxfWarn(...args: unknown[]): void {
  if (!enabled) return;
  console.warn('[DXF]', ...args);
}

export function dxfTable(rows: Record<string, unknown>[]): void {
  if (!enabled || rows.length === 0) return;
  console.table(rows);
}
