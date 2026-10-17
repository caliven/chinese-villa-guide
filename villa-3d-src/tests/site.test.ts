import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { site, floors, frontFieldLevel, courtyardFront } from "../src/data";
import { buildContextGround, buildRoad } from "../src/site-ground";
import { buildSurroundingHouses, makeRamp, buildCourtyard, buildExistingHouses, neighborBayPlan } from "../src/terrain";
import { surroundings as c, forestTrees, groundHeight, roadHeight, terraceContours } from "../src/surroundings";
import { contourAt } from "../src/contours";
import type { Mats } from "../src/primitives";

const mats = Object.fromEntries(
  [
    "wall",
    "trim",
    "stone",
    "paving",
    "courtyard",
    "neighborCourtyard",
    "roof",
    "dark",
    "wood",
    "grass",
    "soil",
    "metal",
    "glass",
    "lowE",
    "inside",
    "floor",
    "fabric",
    "foliage",
    "trunk",
    "gold",
    "bronze",
    "bronzeDark",
    "marble",
    "darkStone",
    "darkStoneGroove",
    "darkStoneRampMark",
    "sand",
    "british",
  ].map((key) => [key, new THREE.MeshStandardMaterial()]),
) as Mats;
const ground = buildContextGround(mats);
ground.updateMatrixWorld(true);
function hits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, 50, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(root, true).filter(hit => hit.object instanceof THREE.Mesh);
}

test("道路在邻居木房左墙外且只有一层路面，地形不穿过道路", () => {
  const road = buildRoad(mats);
  assert.equal(c.road.x, c.sideHouse.x + c.sideHouse.w);
    for (const z of [-27.1, -24.7, -17.3, -12.4, -7.5, -4.3, 3.7, 8.4]) {
    for (const offset of [0.47, 1.91, 2.81]) {
      const x = c.road.x + offset;
      assert.equal(hits(road, x, z).length, 1, `路面重叠或缺口 @ ${x},${z}`);
      assert.equal(hits(ground, x, z).length, 0, `地形侵入道路 @ ${x},${z}`);
    }
  }
});

test("蓝顶邻房门前弯曲主马路露在田面之上，不被前方低田盖住", () => {
  const road = buildRoad(mats);
  // 重建地形以带上路廊挖空
  const groundCut = buildContextGround(mats);
  groundCut.updateMatrixWorld(true);
  road.updateMatrixWorld(true);
  const samples: [number, number][] = [
    [-20, -23],
    [-18, -22],
    [-12, -24],
    [0, -28],
    [15, -28],
  ];
  for (const [x, z] of samples) {
    const onRoad = hits(road, x, z);
    if (!onRoad.length) continue;
    const onGround = hits(groundCut, x, z);
    assert.ok(onRoad.length >= 1, `弯曲马路缺口 @ ${x},${z}`);
    if (onGround.length) {
      assert.ok(
        onRoad[0].point.y >= onGround[0].point.y - 0.01,
        `田面盖住马路 ${onGround[0].point.y.toFixed(2)} ≥ 路 ${onRoad[0].point.y.toFixed(2)} @ ${x},${z}`,
      );
    }
  }
});

test("坡长调整后仍接到左侧道路，坡道与接入段不叠面", () => {
  for (const length of [3, 5, 10]) {
    const ramp = makeRamp(new THREE.Group(), mats, -2, length);
    for (const x of [21.45, 23.8, 26.37, 29.67, 33.4]) {
      const h = hits(ramp, x, -7.57);
      assert.equal(h.length, 1, `接入断开或重叠 @ ${x},坡长${length}`);
      assert.equal(hits(ground, x, -7.57).length, 0, `原地形挡住接入段 @ ${x}`);
      const surface = roadHeight(-7.57) + (-2 - c.road.entryY);
      const startX = site.width + length;
      const expected =
        x >= startX
          ? surface
          : site.garageFloor +
            ((x - site.width) / length) * (surface - site.garageFloor);
      assert.ok(
        Math.abs(h[0].point.y - expected) < 0.02,
        `坡面高度偏离 ${Math.abs(h[0].point.y - expected).toFixed(3)}m @ ${x}`,
      );
    }
  }
});

test("辅楼右侧为两级田，后方木房落在第二田，左侧高地高于院坪", () => {
  const top = hits(ground, -0.31, 8.2)[0].point.y;
  const low = hits(ground, -0.31, 2.1)[0].point.y;
  assert.ok(Math.abs(top) < 1e-5);
  assert.ok(Math.abs(low - site.adjacentUnexcavatedLevel) < 1e-5);
  assert.notEqual(low, site.garageFloor, "未开挖的旁田不能绑定地库完成面");
  assert.ok(Math.abs(hits(ground, 12.12, 12.7)[0].point.y - 2.5) < 1e-5);
  assert.ok(Math.abs(hits(ground, 20.12, 21.7)[0].point.y - c.rearHouse.y) < 1e-5);
  assert.ok(hits(ground, 40.12, -3.7)[0].point.y > 0);
  const houses = buildSurroundingHouses(mats);
  const sideBody = houses.getObjectByName("左侧邻居木房")!.children[0];
  const rearBody = houses.getObjectByName("后方第二层梯田木房")!.children[0];
  const sideBounds = new THREE.Box3().setFromObject(sideBody);
  const rearBounds = new THREE.Box3().setFromObject(rearBody);
  assert.ok(Math.abs(sideBounds.max.x - rearBounds.max.x) < 1e-5);
  assert.ok(
    Math.abs(rearBounds.min.x - (site.main.x + site.main.w / 2)) < 1e-5,
  );
  assert.ok(Math.abs(rearBounds.min.y - c.rearSecond.y) < 1e-5);
  assert.equal(c.frontHouse.floors, 2);
  const front = houses.getObjectByName("前方两层砖房")!;
  const frontRoof = front.getObjectByName("人字坡屋顶")!;
  const frontTop = new THREE.Box3().setFromObject(frontRoof).max.y;
  const ridge = floors[0].y + floors[0].height + 0.5;
  assert.ok(frontTop > ridge && frontTop < ridge + 0.2);
  assert.ok(houses.getObjectByName("左侧邻居木房")!.getObjectByName("人字坡屋顶"));
  assert.ok(houses.getObjectByName("后方第二层梯田木房")!.getObjectByName("人字坡屋顶"));
  assert.equal(c.frontHouse.x + c.frontHouse.w, sideBounds.max.x);
  assert.equal(c.frontHouse.x, site.main.x + (site.main.w * 2) / 3);
  assert.equal(c.neighborYard.x + c.neighborYard.w, sideBounds.max.x);
});

test("前方砖房左侧单坡朝左降低，右侧主体三开间堂屋稍宽", () => {
  const h = c.frontHouse;
  const mainW = h.w * (1 - h.wingRatio);
  const plan = neighborBayPlan("own", mainW);
  assert.equal(plan.widths.length, 3);
  assert.equal(plan.hallFromEast, 1);
  assert.ok(plan.widths[1] > plan.widths[0] && plan.widths[1] < plan.widths[0] * 1.35);
  assert.ok(Math.abs(plan.widths[0] - plan.widths[2]) < 1e-6);
  const front = buildSurroundingHouses(mats).getObjectByName("前方两层砖房")!;
  const gable = front.getObjectByName("人字坡屋顶")!;
  const shed = front.getObjectByName("左侧斜坡屋顶")!;
  assert.ok(front.getObjectByName("前方砖房三开间"));
  assert.ok(front.getObjectByName("堂屋门"));
  const gableBox = new THREE.Box3().setFromObject(gable);
  const shedBox = new THREE.Box3().setFromObject(shed);
  assert.ok(shedBox.min.x > gableBox.min.x);
  assert.ok(shedBox.max.x > gableBox.max.x - 0.05);
  assert.ok(shed.userData.eastY < shed.userData.westY - 0.8);
  const peak = h.y + h.floors * h.floorHeight + h.roofRise;
  assert.ok(Math.abs(shed.userData.deckY - (h.y + h.floorHeight)) < 1e-6);
  assert.ok(Math.abs(shed.userData.westY - (peak - 1.8)) < 1e-6);
  assert.ok(shed.userData.deckY < shed.userData.westY - 1);
  assert.ok(shedBox.max.x > c.road.x - 0.8);
  assert.ok(shedBox.max.x < c.road.x - 0.2);
  assert.ok(front.getObjectByName("红色屋顶钢架"));
  assert.ok(front.getObjectByName("一楼楼顶"));
  assert.ok(Math.abs(gableBox.max.x - (h.x + mainW)) < 0.7);
  const sidePlan = neighborBayPlan("side", c.sideHouse.w);
  const hallCenter =
    c.sideHouse.x + c.sideHouse.w - sidePlan.widths[0] - sidePlan.widths[1] / 2;
  assert.ok(Math.abs(c.neighborYard.x - (hallCenter - 0.5)) < 1e-6);
  assert.ok(Math.abs(h.x + mainW - c.neighborYard.x) < 1e-6);
});

test("邻居木房只在原有总宽内分间，堂屋更宽", () => {
  const side = neighborBayPlan("side", c.sideHouse.w);
  const rear = neighborBayPlan("rear", c.rearHouse.w);
  assert.equal(side.widths.length, 3);
  assert.equal(side.hallFromEast, 1);
  assert.ok(side.widths[1] > side.widths[0] * 1.3);
  assert.ok(Math.abs(side.widths[0] - side.widths[2]) < 1e-6);
  assert.ok(Math.abs(side.widths.reduce((sum, width) => sum + width, 0) - c.sideHouse.w) < 1e-6);
  assert.equal(rear.widths.length, 8);
  assert.equal(rear.hallFromEast, 2);
  assert.ok(rear.widths[2] > rear.widths[0] && rear.widths[2] < rear.widths[0] * 1.35);
  for (const index of [1, 3, 4, 5, 6, 7])
    assert.ok(Math.abs(rear.widths[index] - rear.widths[0]) < 1e-6);
  assert.ok(Math.abs(rear.widths.reduce((sum, width) => sum + width, 0) - c.rearHouse.w) < 1e-6);
  const houses = buildSurroundingHouses(mats);
  for (const name of ["左侧邻居木房", "后方第二层梯田木房"]) {
    const house = houses.getObjectByName(name)!;
    assert.ok(house.getObjectByName("堂屋门"));
    assert.ok(house.getObjectByName("人字坡屋顶"));
  }
  assert.ok(houses.getObjectByName("左侧邻居木房")!.getObjectByName("一明两暗"));
  assert.ok(houses.getObjectByName("后方第二层梯田木房")!.getObjectByName("八开间"));
});

test("现状旧木房为人字坡三开间，比左侧邻居大约低30厘米", () => {
  const own = neighborBayPlan("own", 12.3);
  assert.equal(own.widths.length, 3);
  assert.equal(own.hallFromEast, 1);
  assert.ok(own.widths[1] > own.widths[0] && own.widths[1] < own.widths[0] * 1.35);
  assert.ok(Math.abs(own.widths[0] - own.widths[2]) < 1e-6);
  assert.ok(Math.abs(own.widths.reduce((sum, width) => sum + width, 0) - 12.3) < 1e-6);
  const existing = new THREE.Group();
  buildExistingHouses(existing, mats);
  const house = existing.getObjectByName("自家旧木房")!;
  assert.ok(house.getObjectByName("人字坡屋顶"));
  assert.ok(house.getObjectByName("堂屋门"));
  assert.ok(house.getObjectByName("自家三开间"));
  const ownTop = new THREE.Box3().setFromObject(house.getObjectByName("人字坡屋顶")!).max.y;
  const sideTop = new THREE.Box3().setFromObject(
    buildSurroundingHouses(mats).getObjectByName("左侧邻居木房")!.getObjectByName("人字坡屋顶")!,
  ).max.y;
  assert.ok(Math.abs(sideTop - ownTop - 0.3) < 1e-4);
  const rails = existing.getObjectByName("旧砖房屋顶栏杆")!;
  const railBox = new THREE.Box3().setFromObject(rails);
  assert.ok(railBox.min.x < 0.2);
  assert.ok(railBox.max.x < 8.8);
  assert.ok(railBox.min.z < 0.5);
  assert.ok(railBox.max.z > 9.6 && railBox.max.z < 10.2);
  assert.ok(railBox.max.y > 3.9);
  const brick = existing.getObjectByName("自家旧砖房")!;
  const pad = existing.getObjectByName("现状屋前水泥坪")!;
  assert.ok(Math.abs(house.userData.frontZ - brick.userData.frontZ - 0.9) < 1e-6);
  assert.ok(Math.abs(house.userData.frontZ - pad.userData.frontZ - 2) < 1e-6);
  const sideRail = pad.getObjectByName("邻居前坪右侧栏杆")!;
  const sideBox = new THREE.Box3().setFromObject(sideRail);
  assert.ok(sideBox.max.z < c.sideHouse.z - 0.6);
  assert.ok(sideBox.min.z < -6);
  const leftRail = pad.getObjectByName("邻居前坪左侧栏杆")!;
  const leftBox = new THREE.Box3().setFromObject(leftRail);
  assert.ok(leftBox.max.z < c.sideHouse.z - 1.6);
  const brickRightRail = pad.getObjectByName("砖房前坪右侧栏杆")!;
  const brickRightBox = new THREE.Box3().setFromObject(brickRightRail);
  assert.ok(brickRightBox.min.z < contourAt(courtyardFront, 0) + 0.2);
  assert.ok(brickRightBox.max.z > 3);
  assert.ok(pad.getObjectByName("砖房西侧上田的路"));
  const brickPad = pad.getObjectByName("自家旧砖房前水泥坪")!;
  const brickPadBox = new THREE.Box3().setFromObject(brickPad);
  assert.ok(Math.abs(brickPadBox.min.x - -1) < 0.05);
  assert.ok(Math.abs(brickPadBox.min.z - contourAt(courtyardFront, 8.65)) < 0.15);
  assert.ok(brickPadBox.min.z < contourAt(courtyardFront, 0) - 2);
  const neighborPad = pad.getObjectByName("邻居木房前水泥坪")!;
  assert.ok(new THREE.Box3().setFromObject(neighborPad).min.z < -6);
  const farm = existing.getObjectByName("邻居房前农田")!;
  const farmBox = new THREE.Box3().setFromObject(farm);
  assert.ok(farmBox.min.x > site.width - 0.1 && farmBox.max.x > c.road.x - 0.2);
  assert.ok(Math.abs(farmBox.max.y - site.originalField) < 0.05);
  assert.ok(existing.getObjectByName("自家旧木房前水泥坪"));
});

test("树干与树冠都在后方木房之后，两侧田地不再生成树木", () => {
  const trees = forestTrees();
  assert.ok(trees.length > 0);
  assert.ok(trees.every((t) => t.z >= c.forestStart));
  assert.ok(trees.every((t) => t.z - t.r * 2 > c.rearHouse.z + c.rearHouse.d));
});

test("西侧栏杆北端落在院坪西端外沿，不伸到旧 −2.98", () => {
  const deck = buildCourtyard(mats);
  deck.updateMatrixWorld(true);
  const westFront = contourAt(courtyardFront, 0.12);
  let minZ = Infinity;
  deck.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(o);
    const cx = (box.min.x + box.max.x) / 2;
    if (Math.abs(cx - 0.12) > 0.08) return;
    if (box.max.y < 0.8) return;
    if (box.max.z - box.min.z < 2) return; // 西侧整段扶手，排除前缘弧上的短柱
    minZ = Math.min(minZ, box.min.z);
  });
  assert.ok(Number.isFinite(minZ), "应找到西侧栏杆");
  assert.ok(Math.abs(minZ - westFront) < 0.25, `西栏杆北端 ${minZ} 应贴近外沿 ${westFront}`);
  assert.ok(minZ > -1.2, "西栏杆不应再伸到 −2.98");
});

test("院坪原楼梯洞已填平，辅楼前与右侧通道接到同高梯田", () => {
  const deck = buildCourtyard(mats);
  for (const z of [-4.8, -3.2, -1.4])
    assert.ok(Math.abs(hits(deck, 11, z)[0].point.y) < 1e-5);
  const clear = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    const ray = new THREE.Raycaster(a, direction.clone().normalize(), 0, direction.length());
    assert.equal(ray.intersectObject(deck, true).length, 0, "人行通道被护栏封住");
  };
  // 西端外沿约 Z=-0.2，通道取辅楼前墙稍北，避免穿出新弧。
  clear(new THREE.Vector3(5.25, 1, -0.05), new THREE.Vector3(.48, 1, -0.05));
  clear(new THREE.Vector3(.48, 1, -0.05), new THREE.Vector3(.48, 1, 7));
  clear(new THREE.Vector3(.48, 1, 7), new THREE.Vector3(-.5, 1, 7));
  assert.ok(Math.abs(hits(ground, -.5, 7)[0].point.y) < 1e-5);
  const west = contourAt(courtyardFront, 0);
  const east = contourAt(courtyardFront, site.width);
  const mid = contourAt(courtyardFront, 10);
  assert.ok(Math.abs(west - -0.2) < 0.02);
  assert.ok(Math.abs(east - -8.6) < 0.02);
  assert.ok(Math.abs(mid - -5) < 0.05);
  // 自 Z=0 水泥边起算：西0.2、中5、东8.6；后到前总进深 11／15.8／19.4
  assert.ok(Math.abs(site.annex.z - west - 0.2) < 0.02);
  assert.ok(Math.abs(0 - east - 8.6) < 0.02);
  assert.ok(Math.abs(site.oldDepth - west - 11) < 0.05);
  assert.ok(Math.abs(site.oldDepth - mid - 15.8) < 0.05);
  assert.ok(Math.abs(site.oldDepth - east - 19.4) < 0.05);
  const midX = 10.5;
  const midArc = contourAt(courtyardFront, midX);
  const chord = west + (east - west) * (midX / site.width);
  assert.ok(midArc < chord - 0.4, "外沿相对弦线外鼓");
  assert.equal(groundHeight(24, -2), 0);
});

test("地库前第一田低2米，前方两层砖房所在台地再低1.5米", () => {
  const first = hits(ground, 10, -9.5)[0].point.y;
  const second = hits(ground, 10, -16.5)[0].point.y;
  assert.ok(Math.abs(site.garageFloor - first - 2) < 1e-5);
  assert.ok(Math.abs(first - second - 1.5) < 1e-5);
  assert.ok(Math.abs(first - frontFieldLevel) < 1e-5);
  assert.ok(Math.abs(second - c.frontHouse.y) < 1e-5);
  const back = c.frontHouse.z + c.frontHouse.d;
  const lip = contourAt(terraceContours.frontLower, c.frontHouse.x + c.frontHouse.w / 2);
  assert.ok(Math.abs(lip - back - 0.4) < 0.08);
});
