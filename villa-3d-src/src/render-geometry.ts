import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Vertex = { p: THREE.Vector3; n: THREE.Vector3; uv: THREE.Vector2 };
type Face = {
  mesh: THREE.Mesh;
  vertices: Vertex[];
  axes: number[];
  bounds: number[];
  pieces: Vertex[][];
};
// 几何在毫米根坐标下计算：面积类容差 1e-7 ㎡ ≈ 0.1 mm²，长度类容差 0.1 μm。
const areaEpsilon = 0.1;
const lengthEpsilon = 1e-4;
const normalEpsilon = 1e-7;

// 缩放碰撞只检查当前可见的实体表面，标签、路线和隐藏组不能挡住镜头。
export function visibleSurfaceMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (materials.some((material) => material.visible && material.depthTest && material.depthWrite && material.opacity > 0))
      meshes.push(obj);
  });
  return meshes;
}

function cross(a: Vertex, b: Vertex, p: Vertex, axes: number[]) {
  const [u, v] = axes;
  return (b.p.getComponent(u) - a.p.getComponent(u)) * (p.p.getComponent(v) - a.p.getComponent(v))
    - (b.p.getComponent(v) - a.p.getComponent(v)) * (p.p.getComponent(u) - a.p.getComponent(u));
}

function area(points: Vertex[], axes: number[]) {
  let sum = 0;
  for (let i = 1; i < points.length - 1; i++)
    sum += cross(points[0], points[i], points[i + 1], axes);
  return Math.abs(sum) / 2;
}

function split(points: Vertex[], a: Vertex, b: Vertex, axes: number[], sign: number) {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const dp = sign * cross(a, b, p, axes), dq = sign * cross(a, b, q, axes);
    if (dp >= -areaEpsilon) inside.push(p);
    if (dp <= areaEpsilon) outside.push(p);
    if ((dp > areaEpsilon && dq < -areaEpsilon) || (dp < -areaEpsilon && dq > areaEpsilon)) {
      const t = dp / (dp - dq);
      const cut = {
        p: p.p.clone().lerp(q.p, t),
        n: p.n.clone().lerp(q.n, t).normalize(),
        uv: p.uv.clone().lerp(q.uv, t),
      };
      inside.push(cut);
      outside.push(cut);
    }
  }
  return { inside, outside };
}

// 用三角形的三个半平面裁掉重叠部分，保留原表面的法线和贴图坐标。
function subtract(points: Vertex[], cover: Face) {
  const sign = Math.sign(cross(cover.vertices[0], cover.vertices[1], cover.vertices[2], cover.axes));
  let remainder = points;
  const result: Vertex[][] = [];
  for (let i = 0; i < 3 && remainder.length >= 3; i++) {
    const halves = split(remainder, cover.vertices[i], cover.vertices[(i + 1) % 3], cover.axes, sign);
    if (area(halves.outside, cover.axes) > areaEpsilon) result.push(halves.outside);
    remainder = halves.inside;
  }
  return result;
}

function eligible(obj: THREE.Object3D, skip: Set<THREE.Object3D>, includeTransmission = false): obj is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh || Array.isArray(obj.material)
    || obj.material.transparent || (!includeTransmission && (obj.material as THREE.MeshPhysicalMaterial).transmission > 0))
    return false;
  for (let p: THREE.Object3D | null = obj; p; p = p.parent)
    if (skip.has(p)) return false;
  return true;
}

// 仅清理同一个可见性组内的平直共面表面。独立开关的房子、楼层、车和玻璃保留各自几何。
// 后添加的窗套、柱脚、线脚覆盖底面；尺寸、外轮廓和非共面的曲面都不移动。
export function removeCoplanarOverlap(root: THREE.Object3D, skip = new Set<THREE.Object3D>()) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const planes = new Map<string, Face[]>();
  const faces = new Map<THREE.Mesh, Face[]>();
  const transforms = new Map<THREE.Mesh, THREE.Matrix4>();
  root.traverse((mesh) => {
    if (!eligible(mesh, skip)) return;
    if (Object.keys(mesh.geometry.attributes).some((name) => !["position", "normal", "uv", "uv1"].includes(name))) return;
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    transforms.set(mesh, transform);
    const normals = new THREE.Matrix3().getNormalMatrix(transform);
    const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal");
    const uv = mesh.geometry.getAttribute("uv"), index = mesh.geometry.index;
    const list: Face[] = [];
    faces.set(mesh, list);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map((j): Vertex => {
        const k = index ? index.getX(i + j) : i + j;
        return {
          p: new THREE.Vector3().fromBufferAttribute(position, k).applyMatrix4(transform),
          n: normal ? new THREE.Vector3().fromBufferAttribute(normal, k).applyNormalMatrix(normals) : new THREE.Vector3(),
          uv: uv ? new THREE.Vector2(uv.getX(k), uv.getY(k)) : new THREE.Vector2(),
        };
      });
      const n = vertices[1].p.clone().sub(vertices[0].p).cross(vertices[2].p.clone().sub(vertices[0].p)).normalize();
      if (!normal) vertices.forEach((v) => v.n.copy(n));
      const axis = [0, 1, 2].find((k) => Math.abs(n.getComponent(k)) > 1 - normalEpsilon);
      const axes = [0, 1, 2].filter((k) => k !== (axis ?? 2));
      const bounds = [
        Math.min(...vertices.map((v) => v.p.getComponent(axes[0]))),
        Math.min(...vertices.map((v) => v.p.getComponent(axes[1]))),
        Math.max(...vertices.map((v) => v.p.getComponent(axes[0]))),
        Math.max(...vertices.map((v) => v.p.getComponent(axes[1]))),
      ];
      const face: Face = { mesh, vertices, axes, bounds, pieces: [vertices] };
      list.push(face);
      if (axis === undefined) continue;
      const key = `${axis}:${Math.sign(n.getComponent(axis))}:${Math.round(vertices[0].p.getComponent(axis) * 10)}`;
      if (!planes.has(key)) planes.set(key, []);
      planes.get(key)!.push(face);
    }
  });
  const changed = new Set<THREE.Mesh>();
  for (const list of planes.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length - 1; i++) {
      const face = list[i];
      for (let j = i + 1; j < list.length && face.pieces.length; j++) {
        const cover = list[j];
        if (face.mesh === cover.mesh || cover.bounds[0] >= face.bounds[2] - lengthEpsilon
          || face.bounds[0] >= cover.bounds[2] - lengthEpsilon || cover.bounds[1] >= face.bounds[3] - lengthEpsilon
          || face.bounds[1] >= cover.bounds[3] - lengthEpsilon) continue;
        const pieces = face.pieces.flatMap((piece) => subtract(piece, cover));
        const oldArea = face.pieces.reduce((sum, p) => sum + area(p, face.axes), 0);
        const newArea = pieces.reduce((sum, p) => sum + area(p, face.axes), 0);
        if (oldArea - newArea > areaEpsilon) {
          face.pieces = pieces;
          changed.add(face.mesh);
        }
      }
    }
  }
  for (const mesh of changed) {
    const local = transforms.get(mesh)!.clone().invert();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(local);
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    for (const face of faces.get(mesh)!)
      for (const piece of face.pieces)
        for (let i = 1; i < piece.length - 1; i++)
          for (const v of [piece[0], piece[i], piece[i + 1]]) {
            positions.push(...v.p.clone().applyMatrix4(local).toArray());
            normals.push(...v.n.clone().applyNormalMatrix(normalMatrix).toArray());
            uvs.push(v.uv.x, v.uv.y);
          }
    if (!positions.length) {
      mesh.removeFromParent();
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    mesh.geometry = geometry;
  }
  return changed.size;
}

export function batchStatic(root: THREE.Object3D, skip = new Set<THREE.Object3D>()) {
  removeCoplanarOverlap(root, skip);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[]; geometry: THREE.BufferGeometry[] }>();
  root.traverse((obj) => {
    // 透射玻璃写入深度，合并后仍由每个片元决定前后；无需像透明度混合那样逐块排序。
    if (!eligible(obj, skip, true) || obj.geometry.getAttribute("position").count === 0) return;
    let geo = obj.geometry.clone().applyMatrix4(inverse.clone().multiply(obj.matrixWorld));
    if (geo.index) {
      const expanded = geo.toNonIndexed();
      geo.dispose();
      geo = expanded;
    }
    geo.deleteAttribute("uv1");
    // 坡瓦和坡道没有贴图坐标，盒子有。补齐空 UV 后才能使用同一材质合并。
    if (!geo.hasAttribute("uv"))
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
    const attrs = Object.keys(geo.attributes).sort().join(",");
    const key = `${obj.material.uuid}:${obj.castShadow}:${obj.receiveShadow}:${attrs}`;
    if (!groups.has(key)) groups.set(key, { material: obj.material, meshes: [], geometry: [] });
    const entry = groups.get(key)!;
    entry.meshes.push(obj);
    entry.geometry.push(geo);
  });
  for (const entry of groups.values()) {
    if (entry.geometry.length > 1) {
      const geometry = mergeGeometries(entry.geometry, false);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, entry.material);
        mesh.name = `${root.name || "静态构件"}·${entry.material.name || entry.material.type}`;
        mesh.castShadow = entry.meshes[0].castShadow;
        mesh.receiveShadow = entry.meshes[0].receiveShadow;
        entry.meshes.forEach((m) => m.removeFromParent());
        root.add(mesh);
      }
    }
    entry.geometry.forEach((g) => g.dispose());
  }
}
