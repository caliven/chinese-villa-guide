import * as THREE from "three";
import { site } from "./data";
import type { LayoutDraft } from "./layout-draft";
import { resolveLayoutFacades } from "./facade-layout";

/** 一楼中央入口内侧面向室内；坐标单位毫米。 */
export function walkEntryStart(draft: LayoutDraft) {
  const face = resolveLayoutFacades(draft).facades[0]![0]!;
  const dx = face.b[0] - face.a[0], dz = face.b[1] - face.a[1], length = Math.hypot(dx, dz);
  const center = draft.portico.x + draft.portico.w / 2;
  const doors = face.openings.filter(o => o.door)
    .filter(o => { const x = face.a[0] + dx * o.at / length; return x > draft.portico.x && x < draft.portico.x + draft.portico.w; });
  doors.sort((a, b) => Math.abs(face.a[0] + dx * a.at / length - center) - Math.abs(face.a[0] + dx * b.at / length - center));
  const at = doors[0]?.at ?? Math.max(0, Math.min(length, (center - face.a[0]) * length / dx));
  const x = face.a[0] + dx * at / length, z = face.a[1] + dz * at / length;
  let nx = -dz / length, nz = dx / length;
  if (nx * (site.main.x + site.main.w / 2 - x) + nz * (site.main.z + site.main.d / 2 - z) < 0) { nx = -nx; nz = -nz; }
  return { x: x + nx * 500, z: z + nz * 500, directionX: nx, directionZ: nz };
}

/** 第一人称位移在水平面，斜向速度与直行一致。 */
export function walkDirection(camera: THREE.Camera, keys: ReadonlySet<string>) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) return new THREE.Vector3();
  forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const motion = new THREE.Vector3();
  if (keys.has("KeyW") || keys.has("ArrowUp")) motion.add(forward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) motion.sub(forward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) motion.add(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) motion.sub(right);
  return motion.lengthSq() ? motion.normalize() : motion;
}

/** 相机以人身半径避开墙体，分别尝试 X/Z 以便沿墙滑动。 */
export function advanceWalk(position: THREE.Vector3, delta: THREE.Vector3, walls: THREE.Object3D[], radius = .22) {
  const ray = new THREE.Raycaster();
  for (const axis of ["x", "z"] as const) {
    const distance = delta[axis];
    if (Math.abs(distance) < 1e-8) continue;
    const direction = new THREE.Vector3(); direction[axis] = Math.sign(distance);
    ray.set(position, direction); ray.far = Math.abs(distance) + radius;
    const hit = ray.intersectObjects(walls, false)[0];
    position[axis] += Math.sign(distance) * (hit ? Math.min(Math.abs(distance), Math.max(0, hit.distance - radius)) : Math.abs(distance));
  }
  return position;
}

/** 每轴先避墙，再沿实际楼板／踏步上下移动；无可及支撑时不能迈入洞口。 */
export function advanceWalkOnSurfaces(position: THREE.Vector3, delta: THREE.Vector3, walls: THREE.Object3D[], surfaces: THREE.Object3D[], eyeHeight = 1.6, maxStep = .3) {
  const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0);
  for (const axis of ["x", "z"] as const) {
    if (Math.abs(delta[axis]) < 1e-8) continue;
    const before = position.clone(), step = new THREE.Vector3(); step[axis] = delta[axis];
    advanceWalk(position, step, walls);
    const foot = before.y - eyeHeight;
    ray.set(new THREE.Vector3(position.x, foot + maxStep, position.z), new THREE.Vector3(0, -1, 0));
    ray.far = maxStep * 2;
    const hit = ray.intersectObjects(surfaces, false).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).dot(up) > .7);
    if (hit) position.y = hit.point.y + eyeHeight;
    else position.copy(before);
  }
  return position;
}
