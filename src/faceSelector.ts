import * as THREE from 'three';
import type { OcctResult } from './types';

export function pickBrepFace(
  result: OcctResult,
  meshObject: THREE.Mesh,
  faceIndexFromRaycaster: number
): { meshIndex: number; faceIndex: number } | null {
  const meshIndex = meshObject.userData.meshIndex as number;
  if (meshIndex === undefined || !result.meshes[meshIndex]) return null;

  // faceIndexFromRaycaster は Three.js Raycaster が返す三角形インデックス（indexed geometry では index 属性の開始位置 / 3）
  const triangleIndex = faceIndexFromRaycaster;
  const mesh = result.meshes[meshIndex];
  const faceIdx = mesh.brep_faces.findIndex(
    f => triangleIndex >= f.first && triangleIndex <= f.last
  );
  if (faceIdx === -1) return null;
  return { meshIndex, faceIndex: faceIdx };
}
