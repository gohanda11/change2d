import type { Vec3, OcctMesh, OcctBrepFace } from './types';

export function getVec3(arr: number[] | Float32Array, index: number): Vec3 {
  return {
    x: arr[index * 3],
    y: arr[index * 3 + 1],
    z: arr[index * 3 + 2],
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vec3): Vec3 {
  const l = len(v);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize(cross(sub(b, a), sub(c, a)));
}

function computeFaceBasis(mesh: OcctMesh, face: OcctBrepFace): {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
} {
  const positions = mesh.attributes.position.array;
  let nx = 0, ny = 0, nz = 0;
  for (let t = face.first; t <= face.last; t++) {
    const i0 = mesh.index.array[t * 3];
    const i1 = mesh.index.array[t * 3 + 1];
    const i2 = mesh.index.array[t * 3 + 2];
    const a = getVec3(positions, i0);
    const b = getVec3(positions, i1);
    const c = getVec3(positions, i2);
    const n = triangleNormal(a, b, c);
    nx += n.x; ny += n.y; nz += n.z;
  }
  const normal = normalize({ x: nx, y: ny, z: nz });
  const worldUp = Math.abs(normal.z) < 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(normal, worldUp));
  const v = normalize(cross(normal, u));
  const origin = getVec3(positions, mesh.index.array[face.first * 3]);
  return { origin, normal, u, v };
}

function extractBoundaryEdges(mesh: OcctMesh, face: OcctBrepFace): [number, number][] {
  const edgeCount = new Map<string, number>();
  const edgeMap = new Map<string, [number, number]>();
  for (let t = face.first; t <= face.last; t++) {
    const i0 = mesh.index.array[t * 3];
    const i1 = mesh.index.array[t * 3 + 1];
    const i2 = mesh.index.array[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as [number, number][]) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      edgeMap.set(key, [a, b]);
    }
  }
  const boundary: [number, number][] = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) boundary.push(edgeMap.get(key)!);
  }
  return boundary;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function buildLoops(edges: [number, number][]): number[][] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  const remaining = new Set<string>(edges.map(([a, b]) => edgeKey(a, b)));
  const loops: number[][] = [];

  while (remaining.size > 0) {
    const startKey = remaining.values().next().value as string;
    const [startA, startB] = startKey.split('-').map(Number);
    let current = startB;
    let prev = startA;
    remaining.delete(startKey);

    const loop: number[] = [startA];

    while (true) {
      const neighbors = adj.get(current)!;
      const next = neighbors.find(n => n !== prev);
      if (next === undefined) break;

      const key = edgeKey(current, next);
      if (!remaining.has(key)) break;
      remaining.delete(key);

      loop.push(current);
      prev = current;
      current = next;

      if (current === startA) break;
    }

    if (loop.length >= 3 && current === startA) {
      loops.push(loop);
    }
  }

  return loops;
}

export function extractFaceLoops2D(mesh: OcctMesh, face: OcctBrepFace): {
  loops: [number, number][][];
  normal: Vec3;
} {
  const { origin, normal, u, v } = computeFaceBasis(mesh, face);
  const edges = extractBoundaryEdges(mesh, face);
  const loops3d = buildLoops(edges);
  const positions = mesh.attributes.position.array;
  const loops = loops3d.map(loop =>
    loop.map(idx => {
      const p = getVec3(positions, idx);
      const d = sub(p, origin);
      return [dot(d, u), dot(d, v)] as [number, number];
    })
  );
  return { loops, normal };
}

// 小数点以下で同一視する比較（テスト用）
export function loopsEqualApprox(
  actual: [number, number][][],
  expected: [number, number][][]
): boolean {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a.length !== e.length) return false;
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j][0] - e[j][0]) > 1e-3 || Math.abs(a[j][1] - e[j][1]) > 1e-3) {
        return false;
      }
    }
  }
  return true;
}
