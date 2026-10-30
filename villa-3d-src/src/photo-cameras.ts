import * as THREE from "three";

export type PhotoView = "front" | "left" | "right" | "overhead" | "aerial";
export const photoViews: PhotoView[] = ["front", "left", "right", "overhead", "aerial"];
export const previewCameras: Record<PhotoView, { pitch: number; yaw: number; fov: number }> = {
  front: { pitch: 16, yaw: 0, fov: 32 },
  left: { pitch: 28, yaw: 48, fov: 32 },
  right: { pitch: 28, yaw: -48, fov: 32 },
  overhead: { pitch: 62, yaw: 22, fov: 35 },
  aerial: { pitch: 30, yaw: 22, fov: 35 },
};

/** 只调整相机，不缩放、拉伸或旋转房屋；以真实八角点同时约束画幅宽高。 */
export function fitPhotoCamera(camera: THREE.PerspectiveCamera, bounds: THREE.Box3, view: PhotoView) {
  const preset = previewCameras[view];
  const pitch = THREE.MathUtils.degToRad(preset.pitch), yaw = THREE.MathUtils.degToRad(preset.yaw);
  const offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const target = bounds.getCenter(new THREE.Vector3());
  const forward = offset.clone().negate();
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const up = right.clone().cross(forward).normalize();
  camera.clearViewOffset();
  camera.fov = preset.fov;
  camera.zoom = 1;
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), horizontal = vertical * camera.aspect;
  let distance = 13;
  for (const point of boxCorners(bounds)) {
    const corner = point.sub(target), depth = corner.dot(offset);
    distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / (horizontal * .84),
      depth + Math.abs(corner.dot(up)) / (vertical * .84));
  }
  camera.position.copy(target).addScaledVector(offset, distance);
  camera.up.set(0, 1, 0);
  camera.near = .08;
  camera.far = Math.max(400, distance * 8);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { target, distance };
}

export function boxCorners(bounds: THREE.Box3) {
  const points: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
    for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
  return points;
}
