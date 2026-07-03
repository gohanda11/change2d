import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { OcctResult, OcctMesh } from './types';
import { pickBrepFace } from './faceSelector';

export class Viewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private pointer: THREE.Vector2;
  private modelGroup: THREE.Group;
  private highlightMesh: THREE.LineSegments | null = null;
  private highlightFillMesh: THREE.Mesh | null = null;
  private result: OcctResult | null = null;
  private onFaceClickCallback: ((selection: { meshIndex: number; faceIndex: number; triangleCount: number } | null) => void) | null = null;

  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    this.camera.position.set(50, 50, 50);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.scene.add(new THREE.GridHelper(100, 20, 0x555555, 0x333333));
    this.scene.add(new THREE.AxesHelper(10));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    this.animate();

    window.addEventListener('resize', () => this.onWindowResize());
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  private onWindowResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  loadModel(result: OcctResult): void {
    this.result = result;
    this.clearModel();
    this.clearHighlight();

    for (let i = 0; i < result.meshes.length; i++) {
      const mesh = result.meshes[i];
      const threeMesh = this.createThreeMesh(mesh, i);
      this.modelGroup.add(threeMesh);
    }

    this.fitCameraToModel();
  }

  private createThreeMesh(mesh: OcctMesh, meshIndex: number): THREE.Mesh {
    const positions = mesh.attributes.position.array;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(mesh.index.array);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: mesh.color ? new THREE.Color(...mesh.color) : 0xaaaaaa,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const threeMesh = new THREE.Mesh(geometry, material);
    threeMesh.userData.meshIndex = meshIndex;
    return threeMesh;
  }

  private fitCameraToModel(): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.5 || 10;

    // Position the camera along the shortest dimension so the largest face is front-facing.
    const minDim = Math.min(size.x, size.y, size.z);
    const cameraPos = center.clone();
    if (minDim === size.x) {
      cameraPos.x += distance;
    } else if (minDim === size.y) {
      cameraPos.y += distance;
    } else {
      cameraPos.z += distance;
    }

    this.camera.position.copy(cameraPos);
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  private clearModel(): void {
    while (this.modelGroup.children.length > 0) {
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  onFaceClick(callback: (selection: { meshIndex: number; faceIndex: number; triangleCount: number } | null) => void): void {
    this.onFaceClickCallback = callback;
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.result) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.modelGroup.children, false);

    if (intersects.length === 0) {
      this.clearHighlight();
      this.onFaceClickCallback?.(null);
      return;
    }

    const selection = this.pickBestFace(intersects);

    if (selection) {
      this.highlightFace(selection.meshIndex, selection.faceIndex, this.result);
    } else {
      this.clearHighlight();
    }

    this.onFaceClickCallback?.(selection);
  }

  private pickBestFace(intersects: THREE.Intersection[]): { meshIndex: number; faceIndex: number; triangleCount: number } | null {
    const candidates = new Map<string, { meshIndex: number; faceIndex: number; triangleCount: number; distance: number }>();

    for (const hit of intersects) {
      const meshObject = hit.object as THREE.Mesh;
      const picked = pickBrepFace(this.result!, meshObject, hit.faceIndex ?? 0);
      if (!picked) continue;

      const mesh = this.result!.meshes[picked.meshIndex];
      const face = mesh.brep_faces[picked.faceIndex];
      const triangleCount = face.last - face.first + 1;
      const key = `${picked.meshIndex}-${picked.faceIndex}`;

      if (!candidates.has(key) || hit.distance < candidates.get(key)!.distance) {
        candidates.set(key, { meshIndex: picked.meshIndex, faceIndex: picked.faceIndex, triangleCount, distance: hit.distance });
      }
    }

    if (candidates.size === 0) return null;

    // Prefer the largest face; if multiple faces tie, pick the closest one.
    const sorted = Array.from(candidates.values()).sort((a, b) => {
      if (b.triangleCount !== a.triangleCount) return b.triangleCount - a.triangleCount;
      return a.distance - b.distance;
    });

    return sorted[0];
  }

  highlightFace(meshIndex: number, faceIndex: number, result: OcctResult): void {
    this.clearHighlight();

    const mesh = result.meshes[meshIndex];
    const face = mesh.brep_faces[faceIndex];
    const positions: number[] = [];
    const indices: number[] = [];

    for (let t = face.first; t <= face.last; t++) {
      const i0 = mesh.index.array[t * 3];
      const i1 = mesh.index.array[t * 3 + 1];
      const i2 = mesh.index.array[t * 3 + 2];
      const p0 = this.getVertex(mesh, i0);
      const p1 = this.getVertex(mesh, i1);
      const p2 = this.getVertex(mesh, i2);

      const base = positions.length / 3;
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      indices.push(base, base + 1, base + 2);

      // wireframe edges
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      positions.push(p2.x, p2.y, p2.z, p0.x, p0.y, p0.z);
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2, depthTest: false });
    this.highlightMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    this.highlightMesh.renderOrder = 999;
    this.modelGroup.add(this.highlightMesh);

    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.slice(0, (face.last - face.first + 1) * 9), 3));
    fillGeometry.setIndex(indices);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.highlightFillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    this.highlightFillMesh.renderOrder = 998;
    this.modelGroup.add(this.highlightFillMesh);
  }

  private getVertex(mesh: OcctMesh, index: number): THREE.Vector3 {
    const arr = mesh.attributes.position.array;
    return new THREE.Vector3(arr[index * 3], arr[index * 3 + 1], arr[index * 3 + 2]);
  }

  clearHighlight(): void {
    if (this.highlightMesh) {
      this.modelGroup.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      (this.highlightMesh.material as THREE.Material).dispose();
      this.highlightMesh = null;
    }
    if (this.highlightFillMesh) {
      this.modelGroup.remove(this.highlightFillMesh);
      this.highlightFillMesh.geometry.dispose();
      (this.highlightFillMesh.material as THREE.Material).dispose();
      this.highlightFillMesh = null;
    }
  }
}
