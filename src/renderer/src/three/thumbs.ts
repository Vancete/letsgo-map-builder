// Thumbnails of the catalog's assets: each model rendered alone, three-quarter view, transparent background, saved as PNG
// in the cache (cache/thumbs/<id>.png).
import * as THREE from 'three';
import { buildObject, fetchModel } from './models';
import type { AssetEntry } from '@shared/types';

const SIZE = 192;

export class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 100000);
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6b5f4a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 0.8);
    this.scene.add(sun);
  }

  dispose() {
    this.renderer.dispose();
  }

  private async waitTextures(obj: THREE.Object3D) {
    const pending: Promise<void>[] = [];
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const map = (o.material as THREE.MeshLambertMaterial).map;
        if (map && !map.image)
          pending.push(
            new Promise((res) => {
              const t0 = performance.now();
              const check = () => (map.image || performance.now() - t0 > 4000 ? res() : setTimeout(check, 15));
              check();
            }),
          );
      }
    });
    await Promise.all(pending);
  }

  async render(asset: AssetEntry): Promise<Uint8Array> {
    const model = await fetchModel(asset.id);
    const obj = buildObject(model);
    await this.waitTextures(obj);
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const flat = size.y < Math.max(size.x, size.z) * 0.08;
    const dir = flat ? new THREE.Vector3(0.25, 1, 0.55).normalize() : new THREE.Vector3(0.85, 0.65, 1).normalize();
    const radius = Math.max(1, size.length() / 2);
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    this.camera.position.copy(center).addScaledVector(dir, dist * 0.92);
    this.camera.near = dist / 100;
    this.camera.far = dist * 4;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    obj.removeFromParent();
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('thumbnail');
    return new Uint8Array(await blob.arrayBuffer());
  }
}

export function thumbUrl(id: string, version: number) {
  return `lgcache://thumbs/${encodeURIComponent(id)}.png?v=${version}`;
}
