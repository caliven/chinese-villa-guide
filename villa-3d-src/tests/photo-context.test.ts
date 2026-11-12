import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Mats } from "../src/primitives";
import { easternPhotoHouses, easternPhotoContours, distanceToPhotoPath } from "../src/photo-context-layout";
import { createJoinedTerrainSampler, groundHeight, handmadeTerrainBounds, northPhotoLayout, villageRoadCenter, villageRoadElevation, villageRoadEdges, surroundings as c } from "../src/surroundings";
import { buildContextGround, buildRoad } from "../src/site-ground";
import { buildNorthPhotoContext } from "../src/site-photo-context";
import { buildSurroundingHouses } from "../src/terrain";
import { contourAt } from "../src/contours";
import { sunOcclusion } from "../src/sun-occlusion";

const mats = Object.fromEntries([
  "wall", "trim", "stone", "paving", "courtyard", "neighborCourtyard", "roof", "dark", "wood",
  "grass", "soil", "metal", "glass", "lowE", "inside", "floor", "fabric", "foliage", "trunk", "gold",
  "bronze", "bronzeDark", "marble", "darkStone", "darkStoneGroove", "darkStoneRampMark", "sand", "british",
].map(key => [key, new THREE.MeshStandardMaterial()])) as Mats;
const ground = buildContextGround(mats);
const photo = buildNorthPhotoContext(mats);
ground.updateMatrixWorld(true);
photo.updateMatrixWorld(true);

test("北侧航拍三栋东侧邻房完整落在照片估算台地上", () => {
  const houses = buildSurroundingHouses(mats);
  for (const house of easternPhotoHouses(c.road.x)) {
    const model = houses.getObjectByName(house.name)!;
    assert.ok(model);
    if (house.facing === "west") {
      model.updateWorldMatrix(true, true);
      const door = new THREE.Box3().setFromObject(model.getObjectByName("邻房大门")!);
      assert.equal(model.userData.stories, house.stories);
      assert.ok(door.max.x < house.x, "大门应位于房屋西墙外侧");
      assert.ok(Math.abs(door.getCenter(new THREE.Vector3()).z - (house.z + house.d / 2)) < 0.01);
      if (house.kind === "timber") {
        assert.equal(house.h, 3200);
        assert.equal(house.w, 6667);
      }
    }
    const left = house.x - (house.kind === "masonry" && house.facing !== "west" ? 2800 : 0);
    for (const u of [0.05, 0.5, 0.95]) {
      for (const v of [0.05, 0.5, 0.95]) {
        const x = left + (house.x + house.w - left) * u, z = house.z + house.d * v;
        assert.ok(Math.abs(groundHeight(x, z) - house.y) < 0.02, `${house.name} 房基 @ ${x},${z}`);
        const hits = new THREE.Raycaster(new THREE.Vector3(x, 50000, z), new THREE.Vector3(0, -1, 0)).intersectObject(ground, true);
        assert.ok(hits.length > 0);
        assert.ok(Math.abs(hits[0].point.y - groundHeight(x, z)) < 0.02);
      }
    }
  }
});

test("照片田埂保持前低后高，邻房外留足渐变至DEM的范围", () => {
  const houses = easternPhotoHouses(c.road.x);
  assert.equal(houses[0].y, houses[1].y);
  assert.equal(houses[0].x + houses[0].w, houses[1].x);
  for (const [x, z] of [[c.road.x + 20000, 14500], [c.road.x + 24000, 16000]]) {
    assert.ok(Math.abs(groundHeight(x, z) - houses[1].y) < 0.02);
  }
  const outerHouse = houses[2];
  assert.equal(villageRoadElevation(outerHouse.x + outerHouse.w), outerHouse.y);
  assert.ok(villageRoadElevation(60000) > villageRoadElevation(45000));
  const roadRight = c.road.x + c.road.w;
  const x = 50000;
  const upper = -1000 + (outerHouse.z + 1000) * (x - roadRight) / (outerHouse.x + outerHouse.w - roadRight);
  const lower = contourAt(villageRoadEdges.back, x);
  const levels = [-2000, (-2000 + villageRoadElevation(x)) / 2, villageRoadElevation(x)];
  for (const [i, t] of [0.5 / 4.5, 1.5 / 4.5, 3.25 / 4.5].entries()) {
    assert.ok(Math.abs(groundHeight(x, upper - (upper - lower) * t) - levels[i]) < 1);
  }
  const contours = easternPhotoContours(roadRight);
  for (let x = roadRight; x <= contours[0].points.at(-1)![0]; x += 1307) {
    for (let i = 1; i < contours.length; i++) {
      assert.ok(contourAt(contours[i].points, x) > contourAt(contours[i - 1].points, x));
      assert.ok(contours[i].y > contours[i - 1].y);
      assert.ok(contours[i].y - contours[i - 1].y <= 2500);
    }
  }
  const east = Math.max(...easternPhotoHouses(c.road.x).map(h => h.x + h.w));
  assert.ok(handmadeTerrainBounds().right >= east + 30000);
  // 完整坡面过渡之后回到DEM，与后方大山连成一体。
  const clusterBack = Math.max(...houses.map(h => h.z + h.d));
  const northX = houses[0].x + houses[0].w / 2;
  for (const dist of [24000, 32000]) {
    const z = clusterBack + dist;
    const height = groundHeight(northX, z);
    const dem = createJoinedTerrainSampler()(northX, z) * 1000;
    assert.ok(height > houses[0].y + 4000, `屋后北侧仍低于台地过多 @ ${dist}`);
    assert.ok(Math.abs(height - dem) < dem * 0.2 + 1500, `屋后北侧未接到DEM @ ${dist}`);
  }
});

test("三户屋后共用坡面圆顺抬升，画面与日照射线使用同一高度", () => {
  const [brick, timber, outer] = easternPhotoHouses(c.road.x);
  const sections = [
    { axis: "z", from: brick.z + brick.d + 3000, to: 55000, fixed: brick.x + brick.w / 2 },
    { axis: "x", from: timber.x + timber.w + 2000, to: 112000, fixed: timber.z + timber.d / 2 },
    { axis: "z", from: outer.z + outer.d + 5800, to: 55000, fixed: outer.x + outer.w / 2 },
  ];
  const meshes: THREE.Mesh[] = [];
  ground.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  const blocked = sunOcclusion(meshes);
  for (const section of sections) {
    const pointAt = (station: number) => section.axis === "x"
      ? [station, section.fixed] : [section.fixed, station];
    let [x, z] = pointAt(section.from);
    let previous = groundHeight(x, z);
    let previousSlope: number | undefined;
    for (let station = section.from + 1000; station <= section.to; station += 1000) {
      [x, z] = pointAt(station);
      const height = groundHeight(x, z);
      const slope = (height - previous) / 1000;
      // 按当前照片估算形状约束局部折痕，阈值为视觉回归条件。
      assert.ok(height >= previous - 5, `屋后坡面出现凹槽 @ ${x},${z}`);
      assert.ok(slope < 1.2, `屋后坡面出现陡直板面 @ ${x},${z}`);
      if (previousSlope != null) assert.ok(Math.abs(slope - previousSlope) < 0.35,
        `相邻坡段法线突变 @ ${x},${z}`);
      previous = height;
      previousSlope = slope;
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100000, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(ground, true)[0];
    assert.ok(hit && Math.abs(hit.point.y - previous) < 0.02);
    assert.equal(blocked(ray), true);
    ray.far = 100000 - previous - 1;
    assert.equal(blocked(ray), false);
  }
});

test("双溪在桥西出口汇合，合流向西且水面避免重复叠层", () => {
  const { bridge, courses } = northPhotoLayout();
  assert.equal(courses.length, 2);
  const east = courses[0], main = courses[1], junction = east.points.at(-1)!;
  assert.ok(junction[0] < bridge.x - bridge.width / 2);
  assert.ok(distanceToPhotoPath(junction[0], junction[1], main.points).distance < 0.01);
  assert.ok(east.points[0][0] > junction[0]);
  assert.ok(main.points.at(-1)![0] < junction[0]);
  for (const course of courses) {
    const heights = course.points.map(([x, z]) => groundHeight(x, z));
    assert.ok(heights.at(-1)! < heights[0], `${course.name} 出水端应低于来水端`);
    for (let i = 1; i < heights.length; i++) {
      assert.ok(heights[i] <= heights[i - 1] + 25, `${course.name} 沿确认流向出现反坡`);
    }
    const water = photo.getObjectByName(course.name) as THREE.Mesh;
    assert.ok(water.geometry.getAttribute("position").count > 100);
    assert.equal(water.userData.flowDirection, "过桥洞汇合后向西");
  }
  const water = photo.children.filter(child => courses.some(course => course.name === child.name));
  for (const dx of [-500, 0, 500]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(junction[0] + dx, 50000, junction[1] + 170), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObjects(water).length, 1, "汇合水面应连续且无共面重叠");
  }
});

test("两条北侧道路及便桥存在，大桥桥洞与日照射线贯通", () => {
  const roads = buildRoad(mats);
  roads.updateMatrixWorld(true);
  assert.ok(roads.getObjectByName("蓝顶邻房门前弯曲主马路"));
  for (let i = 10; i < 80; i += 10) {
    const [x, z] = villageRoadCenter[i];
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 50000, z), new THREE.Vector3(0, -1, 0));
    assert.ok(Math.abs(ray.intersectObject(roads, true)[0].point.y - (c.frontHouse.y + 50)) < 0.02);
  }
  assert.ok(photo.getObjectByName("蓝顶邻房门前道路交叉引道"));
  assert.ok(photo.getObjectByName("北侧过桥接入路"));
  assert.ok(photo.getObjectByName("东侧支溪便桥"));
  const { bridge, courses } = northPhotoLayout();
  const creek = courses[0].points.slice().reverse();
  const centerZ = contourAt(creek, bridge.x);
  assert.ok(groundHeight(bridge.x, centerZ) < bridge.top - 2500);
  const object = photo.getObjectByName("蓝顶邻房前跨溪桥")!;
  const axis = new THREE.Vector3(bridge.north[0] - bridge.south[0], 0, bridge.north[1] - bridge.south[1]).normalize();
  const side = new THREE.Vector3(-axis.z, 0, axis.x);
  const under = new THREE.Vector3(bridge.x, bridge.top - 1600, centerZ);
  const across = new THREE.Raycaster(under.clone().addScaledVector(side, 8000), side.clone().negate(), 0, 16000);
  assert.equal(across.intersectObject(object, true).length, 0, "桥下河道不可被实体封堵");
  const down = new THREE.Raycaster(new THREE.Vector3(bridge.x, 20000, centerZ), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(down.intersectObject(object, true)[0].point.y - bridge.top) < 0.02);
  const meshes: THREE.Mesh[] = [];
  object.traverse(child => { if (child instanceof THREE.Mesh) meshes.push(child); });
  const blocked = sunOcclusion(meshes);
  assert.equal(blocked(across), false);
  assert.equal(blocked(down), true);
});

test("斜桥南端引道与村道相接，北侧接入路贴桥面不断开", () => {
  const roads = buildRoad(mats);
  roads.updateMatrixWorld(true);
  const { bridge } = northPhotoLayout();
  const [, , southEast, southWest] = bridge.deck;
  const village = roads.getObjectByName("蓝顶邻房门前弯曲主马路")!;
  const junction = photo.getObjectByName("蓝顶邻房门前道路交叉引道")!;
  const approach = photo.getObjectByName("北侧过桥接入路")!;
  const hit = (object: THREE.Object3D, x: number, z: number) =>
    new THREE.Raycaster(new THREE.Vector3(x, 50000, z), new THREE.Vector3(0, -1, 0)).intersectObject(object, true)[0];
  // 西侧断口中段应被引道盖住，并与村道路面有重叠带。
  const westGapX = southWest[0];
  const westGapZ = (southWest[1] + contourAt(villageRoadEdges.front, westGapX)) / 2;
  assert.ok(hit(junction, westGapX, westGapZ), "斜桥西侧与路缘之间应有引道铺面");
  const overlapZ = contourAt(villageRoadEdges.front, westGapX) + 900;
  assert.ok(hit(junction, westGapX, overlapZ), "引道应伸进村道");
  assert.ok(hit(village, westGapX, overlapZ), "伸进段应落在村道路面上");
  // 北端接入路起点贴桥面标高，不能掉进河床。
  const northHit = hit(approach, bridge.north[0], bridge.north[1] - 600);
  assert.ok(northHit);
  assert.ok(northHit.point.y > bridge.top - 40 && northHit.point.y < bridge.top + 60, "北侧接入路近桥端应接近桥面标高");
  assert.ok(southEast[0] > southWest[0]);
});
