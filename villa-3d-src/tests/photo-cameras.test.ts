import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { boxCorners, fitPhotoCamera, photoViews } from "../src/photo-cameras";
import { photoGroundPoints, photoRegistration, registerPhotoCamera } from "../src/photo-registration";

test("五个机位在桌面横竖画幅与尺寸变化后都完整容纳房屋和地库，不修改模型", () => {
  for (const aspect of [1, 1.5, 1.9, 2.4]) for (const width of [15, 21, 28]) {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -3, -9), new THREE.Vector3(width, 15, 12));
    const before = bounds.clone();
    for (const view of photoViews) {
      const camera = new THREE.PerspectiveCamera(35, aspect);
      fitPhotoCamera(camera, bounds, view);
      for (const point of boxCorners(bounds)) {
        const projected = point.project(camera);
        assert.ok(Math.abs(projected.x) <= .841 && Math.abs(projected.y) <= .841, `${view}: ${projected.toArray()}`);
        assert.ok(projected.z > -1 && projected.z < 1);
      }
      assert.ok(camera.position.y > bounds.getCenter(new THREE.Vector3()).y);
      assert.ok(camera.fov >= 30 && camera.fov <= 40);
      assert.ok(bounds.equals(before));
    }
  }
});

test("五张原片由独立刚性相机对位，前墙落位点误差小于一像素且画幅不拉伸", () => {
  for (const view of photoViews) {
    const camera = new THREE.PerspectiveCamera();
    const { roll, distance } = registerPhotoCamera(camera, view);
    assert.equal(camera.aspect, 1.5);
    assert.ok(Number.isFinite(roll) && distance > 12);
    assert.ok(Math.abs(roll) < THREE.MathUtils.degToRad(3), `${view} 不应靠大幅倾斜相机强行匹配`);
    photoGroundPoints.forEach((point, i) => {
      const projected = point.clone().project(camera);
      const pixel = new THREE.Vector2((projected.x + 1) * 960, (1 - projected.y) * 640);
      assert.ok(pixel.distanceTo(new THREE.Vector2(...photoRegistration[view].pixels[i])) < 1e-5);
      assert.ok(projected.z > -1 && projected.z < 1);
    });
  }
});
