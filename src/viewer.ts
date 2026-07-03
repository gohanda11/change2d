import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { OcctResult, OcctMesh, OcctBrepFace } from './types';
import { pickBrepFace } from './faceSelector';

export class Viewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private pointer: THREE.Vector2;
  private modelGroup: THREE.Group;
  private meshGroup: THREE.Group;
  private overlayGroup: THREE.Group;
  private gridHelper: THREE.GridHelper;
  private axesHelper: THREE.AxesHelper;
  private selectedMesh: THREE.Mesh | null = null;
  private hoverMesh: THREE.Mesh | null = null;
  private result: OcctResult | null = null;
  private onFaceClickCallback: ((selection: { meshIndex: number; faceIndex: number; triangleCount: number } | null) => void) | null = null;

  private pointerDownClient: { x: number; y: number } | null = null;
  private suppressNextClick = false;
  private readonly dragThresholdPx = 3;

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

    this.meshGroup = new THREE.Group();
    this.modelGroup.add(this.meshGroup);
    this.overlayGroup = new THREE.Group();
    this.modelGroup.add(this.overlayGroup);

    this.gridHelper = new THREE.GridHelper(100, 20, 0x555555, 0x333333);
    this.scene.add(this.gridHelper);
    this.axesHelper = new THREE.AxesHelper(10);
    this.scene.add(this.axesHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    this.animate();

    window.addEventListener('resize', () => this.onWindowResize());
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
    this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.renderer.domElement.addEventListener('pointerup', () => this.onPointerUp());
    this.renderer.domElement.addEventListener('pointercancel', () => this.onPointerCancel());
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
      this.meshGroup.add(threeMesh);
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

    // Keep grid and axes centered on the model so they are not left at the origin.
    this.gridHelper.position.copy(center);
    this.gridHelper.position.y = center.y;
    this.axesHelper.position.copy(center);
  }

  private clearModel(): void {
    while (this.meshGroup.children.length > 0) {
      const child = this.meshGroup.children[0];
      this.meshGroup.remove(child);
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

  private onClick(event: MouseEvent): void {
    if (!this.result) return;

    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    this.updatePointer(event);
    const selection = this.raycastFace();

    if (selection) {
      this.highlightSelection(selection.meshIndex, selection.faceIndex, this.result);
    } else {
      this.clearSelectionHighlight();
    }

    this.onFaceClickCallback?.(selection);
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointerDownClient = { x: event.clientX, y: event.clientY };
    this.suppressNextClick = false;
  }

  private onPointerUp(): void {
    this.pointerDownClient = null;
  }

  private onPointerCancel(): void {
    this.pointerDownClient = null;
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.result) return;

    if (this.pointerDownClient) {
      const dx = Math.abs(event.clientX - this.pointerDownClient.x);
      const dy = Math.abs(event.clientY - this.pointerDownClient.y);
      if (dx > this.dragThresholdPx || dy > this.dragThresholdPx) {
        this.suppressNextClick = true;
        return;
      }
    }

    this.updatePointer(event);
    const selection = this.raycastFace();

    if (selection) {
      this.highlightHover(selection.meshIndex, selection.faceIndex, this.result);
    } else {
      this.clearHoverHighlight();
    }
  }

  private updatePointer(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastFace(): { meshIndex: number; faceIndex: number; triangleCount: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.meshGroup.children, false);
    if (intersects.length === 0) return null;
    return this.pickBestFace(intersects);
  }

  private pickBestFace(intersects: THREE.Intersection[]): { meshIndex: number; faceIndex: number; triangleCount: number } | null {
    const candidates: Array<{ meshIndex: number; faceIndex: number; triangleCount: number; distance: number }> = [];

    for (const hit of intersects) {
      const meshObject = hit.object as THREE.Mesh;
      const picked = pickBrepFace(this.result!, meshObject, hit.faceIndex ?? 0);
      if (!picked) continue;

      const mesh = this.result!.meshes[picked.meshIndex];
      const face = mesh.brep_faces[picked.faceIndex];
      const triangleCount = face.last - face.first + 1;
      candidates.push({ meshIndex: picked.meshIndex, faceIndex: picked.faceIndex, triangleCount, distance: hit.distance });
    }

    if (candidates.length === 0) return null;

    // Pick the closest intersected face so back faces remain selectable after rotation.
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = candidates[0];
    return { meshIndex: selected.meshIndex, faceIndex: selected.faceIndex, triangleCount: selected.triangleCount };
  }

  private getFaceNormal(mesh: OcctMesh, face: OcctBrepFace): THREE.Vector3 {
    const i0 = mesh.index.array[face.first * 3];
    const i1 = mesh.index.array[face.first * 3 + 1];
    const i2 = mesh.index.array[face.first * 3 + 2];
    const p0 = this.getVertex(mesh, i0);
    const p1 = this.getVertex(mesh, i1);
    const p2 = this.getVertex(mesh, i2);
    return new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(p1, p0),
      new THREE.Vector3().subVectors(p2, p0)
    ).normalize();
  }

  highlightSelection(meshIndex: number, faceIndex: number, result: OcctResult): void {
    this.clearSelectionHighlight();
    this.selectedMesh = this.createFaceMesh(meshIndex, faceIndex, result, 0xffaa00, 0.6);
    this.overlayGroup.add(this.selectedMesh);
  }

  highlightHover(meshIndex: number, faceIndex: number, result: OcctResult): void {
    if (this.selectedMesh && this.selectedMesh.userData.meshIndex === meshIndex && this.selectedMesh.userData.faceIndex === faceIndex) {
      return; // already highlighted as selection
    }
    this.clearHoverHighlight();
    this.hoverMesh = this.createFaceMesh(meshIndex, faceIndex, result, 0x00ccff, 0.35);
    this.overlayGroup.add(this.hoverMesh);
  }

  private createFaceMesh(
    meshIndex: number,
    faceIndex: number,
    result: OcctResult,
    color: number,
    opacity: number
  ): THREE.Mesh {
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
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const offset = this.getFaceNormal(mesh, face).multiplyScalar(0.05);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    const highlightMesh = new THREE.Mesh(geometry, material);
    highlightMesh.position.copy(offset);
    highlightMesh.renderOrder = 998;
    highlightMesh.userData = { meshIndex, faceIndex };
    return highlightMesh;
  }

  private getVertex(mesh: OcctMesh, index: number): THREE.Vector3 {
    const arr = mesh.attributes.position.array;
    return new THREE.Vector3(arr[index * 3], arr[index * 3 + 1], arr[index * 3 + 2]);
  }

  clearHighlight(): void {
    this.clearSelectionHighlight();
    this.clearHoverHighlight();
  }

  private clearSelectionHighlight(): void {
    if (this.selectedMesh) {
      this.overlayGroup.remove(this.selectedMesh);
      this.selectedMesh.geometry.dispose();
      (this.selectedMesh.material as THREE.Material).dispose();
      this.selectedMesh = null;
    }
  }

  private clearHoverHighlight(): void {
    if (this.hoverMesh) {
      this.overlayGroup.remove(this.hoverMesh);
      this.hoverMesh.geometry.dispose();
      (this.hoverMesh.material as THREE.Material).dispose();
      this.hoverMesh = null;
    }
  }
}
