import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { advanceWalk, advanceWalkOnSurfaces, walkDirection, walkEntryStart } from "../src/scene-walk";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model";
import { clonePublishedLayout, ensureStairRooms } from "../src/layout-draft";
import { fitStairToRoom, stairModelDefaults, stairShape } from "../src/stair-geometry";
import { site } from "../src/data";
import type { Mats } from "../src/primitives";

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

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });

test("漫游入口位于一楼中央门厅内侧并朝向室内", () => {
  const draft = clonePublishedLayout(), start = walkEntryStart(draft);
  assert.ok(start.x >= draft.portico.x && start.x <= draft.portico.x + draft.portico.w);
  assert.ok(start.z > draft.floors[0].front);
  assert.ok(start.directionZ > 0);
});

test("跨层漫游不会踏入没有楼板的挑空，并能按设置跨过较高踏步", () => {
  const mat = new THREE.MeshBasicMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1, .1, 1), mat);
  floor.position.set(0, -.05, 0);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1, .1, 1), mat);
  step.position.set(1, .35, 0);
  floor.updateMatrixWorld(); step.updateMatrixWorld();
  const pos = new THREE.Vector3(0, 1.6, 0);
  advanceWalkOnSurfaces(pos, new THREE.Vector3(0, 0, 1), [], [floor, step], 1.6, .41);
  near(pos.z, 0);
  advanceWalkOnSurfaces(pos, new THREE.Vector3(1, 0, 0), [], [floor, step], 1.6, .41);
  near(pos.y, 2);
  advanceWalkOnSurfaces(pos, new THREE.Vector3(-1, 0, 0), [], [floor, step], 1.6, .41);
  near(pos.y, 1.6);
});

test("漫游可经开启的通楼门与过道进入辅楼", () => {
  const draft = clonePublishedLayout();
  const editor = buildEditorModel(draft, materials(), "full", { walking: true });
  assert.ok(editor.root.getObjectByName("漫游主辅楼间过道"), "须有主辅楼间过道可走面");
  const root = new THREE.Group(); root.scale.setScalar(.001); root.add(editor.root); root.updateMatrixWorld(true);
  // 过道两侧墙（西缘／东缘）各至少一扇通楼门开启。
  const westEdge = Math.min(site.main.x + site.main.w, site.annex.x + site.annex.w);
  const eastEdge = Math.max(site.main.x, site.annex.x);
  let westDoors = 0, eastDoors = 0;
  editor.root.traverse(object => {
    if (!object.userData.walkLaneDoor) return;
    const wx = object.getWorldPosition(new THREE.Vector3()).x * 1000;
    if (Math.abs(wx - westEdge) < 400) westDoors++;
    else if (Math.abs(wx - eastEdge) < 400) eastDoors++;
  });
  assert.ok(westDoors >= 1 && eastDoors >= 1, `过道两侧通楼门均须开启（西${westDoors} 东${eastDoors}）`);
  const walls: THREE.Object3D[] = [];
  editor.root.traverse(object => { if (object.userData.walkWall) walls.push(object); });
  const laneX = Math.min(site.main.x + site.main.w, site.annex.x + site.annex.w);
  const doorZ = 5400;
  const y = (draft.floors[0].y + site.entranceRise) / 1000 + 1.6;
  const pos = new THREE.Vector3((site.main.x + 800) / 1000, y, doorZ / 1000);
  const targetX = (site.annex.x + site.annex.w / 2) / 1000;
  const delta = new THREE.Vector3(targetX - pos.x, 0, 0);
  const count = Math.ceil(Math.abs(delta.x) / .04);
  delta.multiplyScalar(1 / count);
  for (let i = 0; i < count; i++) advanceWalkOnSurfaces(pos, delta.clone(), walls, editor.walkSurfaces);
  assert.ok(pos.x < laneX / 1000, `应穿过过道进入辅楼侧，当前位置 x=${pos.x}`);
  assert.ok(pos.x < (site.annex.x + site.annex.w) / 1000 + .2);
  near(pos.y, y);
  disposeEditorModel(editor.root, new THREE.Scene());
});

test("真实楼板和踏步支持双跑及三跑楼梯上下至三层，覆盖旋转和镜像", () => {
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const)
    for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) {
      const draft = clonePublishedLayout();
      for (const floor of draft.floors) { floor.rooms = []; floor.partitions = []; floor.furniture = []; }
      draft.livingVoid = { ...draft.livingVoid, w: 0, d: 0 };
      const room = { x: site.main.x + 4000, z: site.main.z + 3000, w: 4080, d: 4200 };
      draft.stairLayout = stairModelDefaults({ ...draft.stairLayout, axis, direction, lowerSide, room }, model, draft.floors);
      let stair = fitStairToRoom(draft.stairLayout, draft.floors);
      draft.stairLayout.hole = stairShape(stair).footprint;
      ensureStairRooms(draft);
      stair = fitStairToRoom(draft.stairLayout, draft.floors);
      const shape = stairShape(stair), mid = shape.run + Math.min(stair.flight, stair.landing) / 2;
      const points = [shape.point(shape.lowerAcross + stair.flight / 2, -150), shape.point(shape.lowerAcross + stair.flight / 2, mid),
        shape.point(shape.upperAcross + stair.flight / 2, mid), shape.point(shape.upperAcross + stair.flight / 2, -150)];
      const editor = buildEditorModel(draft, materials(), "full", { walking: true });
      const root = new THREE.Group(); root.scale.setScalar(.001); root.add(editor.root); root.updateMatrixWorld(true);
      const walls: THREE.Object3D[] = []; editor.root.traverse(object => { if (object.userData.walkWall) walls.push(object); });
      const pos = new THREE.Vector3(points[0].x / 1000, (draft.floors[0].y + site.entranceRise) / 1000 + 1.6, points[0].z / 1000);
      const move = (path: typeof points) => {
        for (const point of path.slice(1)) {
          const destination = new THREE.Vector3(point.x / 1000, pos.y, point.z / 1000);
          const delta = destination.clone().sub(pos); delta.y = 0;
          const count = Math.ceil(delta.length() / .04); delta.multiplyScalar(1 / count);
          for (let i = 0; i < count; i++) advanceWalkOnSurfaces(pos, delta, walls, editor.walkSurfaces);
          assert.ok(Math.hypot(pos.x - destination.x, pos.z - destination.z) < .08, `${model} ${axis} ${direction} ${lowerSide}: 无法到达 ${JSON.stringify(point)}, 位置 ${pos.toArray()}`);
        }
      };
      for (let floor = 1; floor <= 2; floor++) {
        move(points);
        const y = draft.floors[floor].y;
        near(pos.y, y / 1000 + 1.6);
        if (floor < 2) {
          // 在上层沿楼梯出口前的楼面回到下一段起点。
          move([points[3], points[0]]);
        }
      }
      for (let floor = 1; floor >= 0; floor--) {
        move([...points].reverse());
        near(pos.y, (draft.floors[floor].y + (floor === 0 ? site.entranceRise : 0)) / 1000 + 1.6);
        if (floor > 0) move([points[0], points[3]]);
      }
      disposeEditorModel(editor.root, new THREE.Scene());
    }
});
