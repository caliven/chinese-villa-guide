import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { advanceWalk, walkDirection } from "../src/scene-walk";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("漫游方向随视角转动，斜向行走不会加速", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(1, 0, 0);
  camera.updateMatrixWorld();
  const forward = walkDirection(camera, new Set(["KeyW"]));
  near(forward.x, 1); near(forward.z, 0);
  const diagonal = walkDirection(camera, new Set(["ArrowUp", "ArrowRight"]));
  near(diagonal.length(), 1); near(diagonal.x, Math.SQRT1_2); near(diagonal.z, Math.SQRT1_2);
  near(walkDirection(camera, new Set(["KeyW", "KeyS"])).length(), 0);
});

test("漫游在墙前停住并可沿墙滑动，门洞可以穿行", () => {
  const material = new THREE.MeshBasicMaterial();
  const wall = (x: number, width: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 3, .2), material);
    mesh.position.set(x, 1.5, 0); mesh.updateMatrixWorld();
    return mesh;
  };
  const walls = [wall(-1.5, 2), wall(1.5, 2)]; // 中间留出一米门洞
  const blocked = new THREE.Vector3(-1, 1.6, -1);
  advanceWalk(blocked, new THREE.Vector3(.2, 0, 2), walls);
  near(blocked.x, -.8); near(blocked.z, -.32);
  advanceWalk(blocked, new THREE.Vector3(-.3, 0, .5), walls);
  near(blocked.x, -1.1); near(blocked.z, -.32);
  const doorway = new THREE.Vector3(0, 1.6, -1);
  advanceWalk(doorway, new THREE.Vector3(0, 0, 2), walls);
  near(doorway.z, 1);
});
