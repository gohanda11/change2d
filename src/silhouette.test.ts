import { describe, it, expect } from 'vitest';
import { extractFaceLoops2D } from './silhouette';
import type { OcctMesh } from './types';

function createCubeMesh(): OcctMesh {
  // 10mm 立方体
  const positions = [
    0, 0, 0,   // 0
    10, 0, 0,  // 1
    10, 10, 0, // 2
    0, 10, 0,  // 3
    0, 0, 10,  // 4
    10, 0, 10, // 5
    10, 10, 10,// 6
    0, 10, 10, // 7
  ];

  const indices = [
    // front (z=0)
    0, 1, 2,
    0, 2, 3,
    // back (z=10)
    5, 4, 7,
    5, 7, 6,
    // bottom (y=0)
    0, 4, 5,
    0, 5, 1,
    // top (y=10)
    2, 6, 7,
    2, 7, 3,
    // right (x=10)
    1, 5, 6,
    1, 6, 2,
    // left (x=0)
    4, 0, 3,
    4, 3, 7,
  ];

  return {
    name: 'cube',
    brep_faces: [
      { first: 0, last: 1, color: null },  // front
      { first: 2, last: 3, color: null },  // back
      { first: 4, last: 5, color: null },  // bottom
      { first: 6, last: 7, color: null },  // top
      { first: 8, last: 9, color: null },  // right
      { first: 10, last: 11, color: null },// left
    ],
    attributes: {
      position: { array: positions },
    },
    index: { array: indices },
  };
}

describe('extractFaceLoops2D', () => {
  it('extracts a 10x10 square loop for each cube face', () => {
    const mesh = createCubeMesh();

    for (const face of mesh.brep_faces) {
      const { loops } = extractFaceLoops2D(mesh, face);
      expect(loops.length).toBe(1);
      const loop = loops[0];
      expect(loop.length).toBe(4);

      const sides = loop.map((p, i) => {
        const next = loop[(i + 1) % loop.length];
        const dx = next[0] - p[0];
        const dy = next[1] - p[1];
        return Math.round(Math.sqrt(dx * dx + dy * dy));
      });

      expect(sides).toEqual([10, 10, 10, 10]);
    }
  });
});
