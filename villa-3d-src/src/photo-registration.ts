import * as THREE from "three";
import type { PhotoView } from "./photo-cameras";

// 在历史实景的主楼前墙两端取点，坐标基准为1920×1280；属于照片估算。
// 这两点只限定落位与尺度；俯仰、方位分别参照各张航拍的地面方向。
export const photoRegistration: Record<PhotoView, {
  yaw: number; pitch: number; pixels: [[number, number], [number, number]];
}> = {
  front: { yaw: 0, pitch: 20, pixels: [[490, 810], [1200, 810]] },
  left: { yaw: 42, pitch: 40, pixels: [[865, 676], [1043, 573]] },
  right: { yaw: -70, pitch: 40, pixels: [[700, 585], [800, 755]] },
  overhead: { yaw: 106, pitch: 80, pixels: [[1180, 560], [1120, 340]] },
  aerial: { yaw: 4, pitch: 30, pixels: [[929, 828], [1098, 822]] },
};
export const photoGroundPoints = [new THREE.Vector3(20.2, 0, -.4), new THREE.Vector3(6.6, 0, -.4)];

/** 固定3:2原片，通过刚性相机姿态、距离和主点偏移对位，不变换模型几何。 */
export function registerPhotoCamera(camera: THREE.PerspectiveCamera, view: PhotoView) {
  const { yaw, pitch, pixels } = photoRegistration[view];
  const p = THREE.MathUtils.degToRad(pitch), y = THREE.MathUtils.degToRad(yaw);
  const direction = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  const target = new THREE.Vector3(13.4, 0, -.4);
  camera.clearViewOffset();
  camera.aspect = 1.5;
  camera.fov = 32;
  camera.zoom = 1;
  camera.near = .08;
  camera.far = 4000;
  const place = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };
  const project = () => photoGroundPoints.map(point => {
    const projected = point.clone().project(camera);
    return new THREE.Vector2((projected.x + 1) * 960, (1 - projected.y) * 640);
  });
  const expected = pixels.map(point => new THREE.Vector2(...point));
  const expectedDelta = expected[1].clone().sub(expected[0]);
  let near = 12, far = 2000;
  for (let i = 0; i < 60; i++) {
    const middle = (near + far) / 2;
    place(middle);
    const projected = project();
    if (projected[0].distanceTo(projected[1]) > expectedDelta.length()) near = middle;
    else far = middle;
  }
  place(far);
  const projected = project(), delta = projected[1].clone().sub(projected[0]);
  const roll = Math.atan2(expectedDelta.y, expectedDelta.x) - Math.atan2(delta.y, delta.x);
  camera.rotateZ(roll);
  camera.updateMatrixWorld(true);
  const actual = project();
  const shift = expected[0].clone().sub(actual[0]).add(expected[1].clone().sub(actual[1])).multiplyScalar(.5);
  camera.setViewOffset(1920, 1280, -shift.x, -shift.y, 1920, 1280);
  camera.updateProjectionMatrix();
  return { target, distance: far, roll };
}
