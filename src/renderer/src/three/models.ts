// Cached game models (LGM) as three.js objects. Templates are built once per asset; instances clone them, sharing
// geometry and materials.
import * as THREE from 'three';
import { decodeLgm, type LgmMaterial, type LgmModel } from '@shared/lgm';

const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

export function textureUrl(name: string) {
  return `lgcache://textures/${encodeURIComponent(name)}.png`;
}

function getTexture(name: string): THREE.Texture {
  let t = textures.get(name);
  if (!t) {
    t = loader.load(textureUrl(name));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    textures.set(name, t);
  }
  return t;
}

export function disposeTextures() {
  for (const t of textures.values()) t.dispose();
  textures.clear();
}

function makeMaterial(m: LgmMaterial, hasColor: boolean): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({
    name: m.name,
    color: m.map ? 0xffffff : new THREE.Color(...m.color),
    map: m.map ? getTexture(m.map) : null,
    alphaTest: m.alphaTest,
    transparent: m.blend,
    depthWrite: !m.blend,
    side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: m.vertexColor && hasColor,
  });
  return mat;
}

export function buildObject(model: LgmModel): THREE.Group {
  const group = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  for (const mesh of model.meshes) {
    const lm = model.materials[mesh.material];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
    if (mesh.normal) g.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3, true));
    const uv = lm?.uvSet === 1 && mesh.uv1 ? mesh.uv1 : mesh.uv0;
    if (uv) {
      // the material's texture scale, baked into the UVs (textures are shared between materials)
      const [su, sv] = lm?.uvScale ?? [1, 1];
      let data = uv;
      if (su !== 1 || sv !== 1) {
        data = new Float32Array(uv.length);
        for (let i = 0; i < uv.length; i += 2) {
          data[i] = uv[i] * su;
          data[i + 1] = uv[i + 1] * sv;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(data, 2));
    }
    if (mesh.color) g.setAttribute('color', new THREE.BufferAttribute(mesh.color, 4, true));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    if (!mesh.normal) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const key = `${mesh.material}|${!!mesh.color}`;
    let mat = mats.get(key);
    if (!mat) mats.set(key, (mat = lm ? makeMaterial(lm, !!mesh.color) : new THREE.MeshLambertMaterial({ color: 0xff00ff })));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false;
    m.receiveShadow = false;
    if (lm?.blend) m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

export async function fetchModel(assetId: string): Promise<LgmModel> {
  return decodeLgm(await window.api.loadModel(assetId));
}

const templates = new Map<string, Promise<THREE.Group>>();

export function getTemplate(assetId: string): Promise<THREE.Group> {
  let p = templates.get(assetId);
  if (!p) {
    p = fetchModel(assetId).then(buildObject);
    p.catch(() => templates.delete(assetId));
    templates.set(assetId, p);
  }
  return p;
}

export function clearTemplates() {
  for (const p of templates.values())
    p.then((g) =>
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      }),
    ).catch(() => {});
  templates.clear();
  disposeTextures();
}

export function placeholder(): THREE.Object3D {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(100, 100, 100).translate(0, 50, 0),
    new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true }),
  );
  m.userData.placeholder = true;
  return m;
}
