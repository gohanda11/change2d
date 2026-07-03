import type { OcctResult } from './types';

declare global {
  interface Window {
    occtimportjs: () => Promise<unknown>;
  }
}

function isOcctResult(value: unknown): value is OcctResult {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.success === 'boolean' &&
    Array.isArray(obj.meshes) &&
    obj.root !== undefined
  );
}

export async function loadStepFile(file: File): Promise<OcctResult> {
  if (typeof window.occtimportjs !== 'function') {
    throw new Error('occt-import-js loader is not available');
  }
  const occt = await window.occtimportjs() as Record<string, (data: Uint8Array, options: Record<string, unknown>) => unknown>;
  if (typeof occt.ReadStepFile !== 'function') {
    throw new Error('occt-import-js ReadStepFile is not available');
  }
  const arrayBuffer = await file.arrayBuffer();
  const content = new Uint8Array(arrayBuffer);
  const result = occt.ReadStepFile(content, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  if (!isOcctResult(result)) {
    throw new Error('STEP file parsing failed or returned unexpected shape');
  }
  if (!result.success) {
    throw new Error('STEP file parsing failed');
  }
  return result;
}
