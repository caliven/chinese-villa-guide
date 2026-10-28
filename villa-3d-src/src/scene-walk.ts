import * as THREE from "three";

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
