export interface Vec3 { x: number; y: number; z: number; }

export interface OcctBrepFace {
  first: number;   // 三角形インデックス（閉区間）
  last: number;    // 三角形インデックス（閉区間）
  color: [number, number, number] | null;
}

export interface OcctMesh {
  name: string;
  color?: [number, number, number];
  brep_faces: OcctBrepFace[];
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  index: { array: number[] };
}

export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

export interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

export interface SelectedFace {
  meshIndex: number;
  faceIndex: number; // meshes[meshIndex].brep_faces 内のインデックス
}
