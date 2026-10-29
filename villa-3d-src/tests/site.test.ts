import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { site, floors, frontFieldLevel, courtyardFront } from "../src/data";
import { buildContextGround, buildRoad } from "../src/site-ground";
import { buildSurroundingHouses, makeRamp, buildCourtyard, buildExistingHouses, neighborBayPlan, clipParkingLine } from "../src/terrain";
import { surroundings as c, forestTrees, groundHeight, roadHeight, rightTerraceBreak, terraceContours } from "../src/surroundings";
import { contourAt } from "../src/contours";
import { garageLayout } from "../src/garage-layout";
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
    new THREE.Vector3(x, 50000, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(root, true).filter(hit => hit.object instanceof THREE.Mesh);
}

test("道路在邻居木房左墙外且只有一层路面，地形不穿过道路", () => {
  const road = buildRoad(mats);
  assert.equal(c.road.x, c.sideHouse.x + c.sideHouse.w);
    for (const z of [-27100, -24700, -17300, -12400, -7500, -4300, 3700, 8400]) {
    for (const offset of [470, 1910, 2810]) {
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
    [-20000, -23000],
    [-18000, -22000],
    [-12000, -24000],
    [0, -28000],
    [15000, -28000],
  ];
  for (const [x, z] of samples) {
    const onRoad = hits(road, x, z);
    if (!onRoad.length) continue;
    const onGround = hits(groundCut, x, z);
    assert.ok(onRoad.length >= 1, `弯曲马路缺口 @ ${x},${z}`);
    if (onGround.length) {
      assert.ok(
        onRoad[0].point.y >= onGround[0].point.y - 10,
        `田面盖住马路 ${onGround[0].point.y.toFixed(0)} ≥ 路 ${onRoad[0].point.y.toFixed(0)} @ ${x},${z}`,
      );
    }
  }
});

test("坡长调整后仍接到左侧道路，坡道与接入段不叠面", () => {
  for (const length of [3000, 5000, 10000]) {
    const ramp = makeRamp(new THREE.Group(), mats, -2000, length);
    for (const x of [21450, 23800, 26370, 29670, 33400]) {
      const h = hits(ramp, x, -7570);
      assert.equal(h.length, 1, `接入断开或重叠 @ ${x},坡长${length}`);
      assert.equal(hits(ground, x, -7570).length, 0, `原地形挡住接入段 @ ${x}`);
      const surface = roadHeight(-7570) + (-2000 - c.road.entryY);
      const startX = site.width + length;
      const expected =
        x >= startX
          ? surface
          : site.garageFloor +
            ((x - site.width) / length) * (surface - site.garageFloor);
      assert.ok(
        Math.abs(h[0].point.y - expected) < 20,
        `坡面高度偏离 ${Math.abs(h[0].point.y - expected).toFixed(1)}mm @ ${x}`,
      );
    }
  }
});

test("坡道前缘收在地库矮墙内侧", () => {
  const innerZ = Math.max(...garageLayout.outerWall.filter(([x]) => x >= site.width).map(([, z]) => z));
  for (const roadY of [-4000, -2000, 0]) {
    const ramp = makeRamp(new THREE.Group(), mats, roadY, 5000);
    assert.equal(hits(ramp, site.width + 1000, innerZ - 10).length, 0);
    assert.equal(hits(ramp, site.width + 1000, innerZ + 50).length, 1);
  }
});

test("车位线按弯曲墙内边裁剪", () => {
  const front: [number, number][] = [[0, 0], [1000, 500], [2000, 0]];
  const clipped = clipParkingLine([0, 250], [2000, 250], front);
  assert.equal(clipped.length, 2);
  assert.deepEqual(clipped, [[[0, 250], [500, 250]], [[1500, 250], [2000, 250]]]);
  assert.deepEqual(clipParkingLine([1000, -100], [1000, 800], front), [[[1000, 500], [1000, 800]]]);
});

test("辅楼右侧为两级田，后方木房落在第二田，左侧高地高于院坪", () => {
  const top = hits(ground, -310, 8200)[0].point.y;
  const low = hits(ground, -310, 2100)[0].point.y;
  assert.ok(Math.abs(top) < 0.01);
  assert.ok(Math.abs(low - site.adjacentUnexcavatedLevel) < 0.01);
  assert.notEqual(low, site.garageFloor, "未开挖的旁田不能绑定地库完成面");
  assert.ok(Math.abs(hits(ground, 12120, 12700)[0].point.y - 2500) < 0.01);
  assert.ok(Math.abs(hits(ground, 20120, 21700)[0].point.y - c.rearHouse.y) < 0.01);
  assert.ok(hits(ground, 40120, -3700)[0].point.y > 0);
  const houses = buildSurroundingHouses(mats);
  const sideBody = houses.getObjectByName("左侧邻居木房")!.children[0];
  const rearBody = houses.getObjectByName("后方第二层梯田木房")!.children[0];
  const sideBounds = new THREE.Box3().setFromObject(sideBody);
  const rearBounds = new THREE.Box3().setFromObject(rearBody);
  assert.ok(Math.abs(sideBounds.max.x - rearBounds.max.x) < 0.01);
  assert.ok(
    Math.abs(rearBounds.min.x - (site.main.x + site.main.w / 2)) < 0.01,
  );
  assert.ok(Math.abs(rearBounds.min.y - c.rearSecond.y) < 0.01);
  assert.equal(c.frontHouse.floors, 2);
  const front = houses.getObjectByName("前方两层砖房")!;
  const frontRoof = front.getObjectByName("人字坡屋顶")!;
  const frontTop = new THREE.Box3().setFromObject(frontRoof).max.y;
  const ridge = floors[0].y + floors[0].height + 500;
  assert.ok(frontTop > ridge && frontTop < ridge + 200);
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
  assert.ok(shedBox.max.x > gableBox.max.x - 50);
  assert.ok(shed.userData.eastY < shed.userData.westY - 800);
  const peak = h.y + h.floors * h.floorHeight + h.roofRise;
  assert.ok(Math.abs(shed.userData.deckY - (h.y + h.floorHeight)) < 1e-6);
  assert.ok(Math.abs(shed.userData.westY - (peak - 1800)) < 1e-6);
  assert.ok(shed.userData.deckY < shed.userData.westY - 1000);
  assert.ok(shedBox.max.x > c.road.x - 800);
  assert.ok(shedBox.max.x < c.road.x - 200);
  assert.ok(front.getObjectByName("红色屋顶钢架"));
  assert.ok(front.getObjectByName("一楼楼顶"));
  assert.ok(Math.abs(gableBox.max.x - (h.x + mainW)) < 700);
  const sidePlan = neighborBayPlan("side", c.sideHouse.w);
  const hallCenter =
    c.sideHouse.x + c.sideHouse.w - sidePlan.widths[0] - sidePlan.widths[1] / 2;
  assert.ok(Math.abs(c.neighborYard.x - (hallCenter - 500)) < 1e-6);
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

test("现状旧木房为人字坡三开间，比左侧邻居大约低300mm", () => {
  const own = neighborBayPlan("own", 12300);
  assert.equal(own.widths.length, 3);
  assert.equal(own.hallFromEast, 1);
  assert.ok(own.widths[1] > own.widths[0] && own.widths[1] < own.widths[0] * 1.35);
  assert.ok(Math.abs(own.widths[0] - own.widths[2]) < 1e-6);
  assert.ok(Math.abs(own.widths.reduce((sum, width) => sum + width, 0) - 12300) < 1e-6);
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
  assert.ok(Math.abs(sideTop - ownTop - 300) < 0.1);
  const rails = existing.getObjectByName("旧砖房屋顶栏杆")!;
  const railBox = new THREE.Box3().setFromObject(rails);
  assert.ok(railBox.min.x < 200);
  assert.ok(railBox.max.x < 8800);
  assert.ok(railBox.min.z < 500);
  assert.ok(railBox.max.z > 9600 && railBox.max.z < 10200);
  assert.ok(railBox.max.y > 3900);
  const brick = existing.getObjectByName("自家旧砖房")!;
  const pad = existing.getObjectByName("现状屋前水泥坪")!;
  assert.ok(Math.abs(house.userData.frontZ - brick.userData.frontZ - 900) < 1e-6);
  assert.ok(Math.abs(house.userData.frontZ - pad.userData.frontZ - 2000) < 1e-6);
  const sideRail = pad.getObjectByName("邻居前坪右侧栏杆")!;
  const sideBox = new THREE.Box3().setFromObject(sideRail);
  assert.ok(sideBox.max.z < c.sideHouse.z - 600);
  assert.ok(sideBox.min.z < -6000);
  const leftRail = pad.getObjectByName("邻居前坪左侧栏杆")!;
  const leftBox = new THREE.Box3().setFromObject(leftRail);
  assert.ok(leftBox.max.z < c.sideHouse.z - 1600);
  const brickRightRail = pad.getObjectByName("砖房前坪右侧栏杆")!;
  const brickRightBox = new THREE.Box3().setFromObject(brickRightRail);
  assert.ok(brickRightBox.min.z < contourAt(courtyardFront, 0) + 200);
  assert.ok(brickRightBox.max.z > 3000);
  assert.ok(pad.getObjectByName("砖房西侧上田的路"));
  const brickPad = pad.getObjectByName("自家旧砖房前水泥坪")!;
  const brickPadBox = new THREE.Box3().setFromObject(brickPad);
  assert.ok(Math.abs(brickPadBox.min.x - -1000) < 50);
  assert.ok(Math.abs(brickPadBox.min.z - contourAt(courtyardFront, 8650)) < 150);
  assert.ok(brickPadBox.min.z < contourAt(courtyardFront, 0) - 2000);
  const neighborPad = pad.getObjectByName("邻居木房前水泥坪")!;
  const neighborPadBox = new THREE.Box3().setFromObject(neighborPad);
  // 水泥进深随 neighborCourtyardPlan.cementDepth（默认 2000），不再写死到 −7800。
  assert.ok(Math.abs(neighborPadBox.min.z - (c.sideHouse.z - 2000)) < 150);
  const neighborYardBeyond = pad.getObjectByName("邻居水泥外院坪");
  if (neighborYardBeyond) {
    assert.ok(new THREE.Box3().setFromObject(neighborYardBeyond).min.z < -6000);
  } else {
    assert.ok(c.neighborYard.z < -6000);
  }
  const farm = existing.getObjectByName("邻居房前农田")!;
  const farmBox = new THREE.Box3().setFromObject(farm);
  assert.ok(farmBox.min.x > site.width - 100 && farmBox.max.x > c.road.x - 200);
  assert.ok(Math.abs(farmBox.max.y - site.originalField) < 50);
  assert.ok(existing.getObjectByName("自家旧木房前水泥坪"));
});

test("树干与树冠都在后方木房之后，两侧田地不再生成树木", () => {
  const trees = forestTrees();
  assert.ok(trees.length > 0);
  assert.ok(trees.every((t) => t.z >= c.forestStart));
  assert.ok(trees.every((t) => t.z - t.r * 2 > c.rearHouse.z + c.rearHouse.d));
});

test("西侧栏杆北端落在院坪西端外沿，不伸到旧 −2980", () => {
  const deck = buildCourtyard(mats);
  deck.updateMatrixWorld(true);
  const westFront = contourAt(courtyardFront, 120);
  let minZ = Infinity;
  deck.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(o);
    const cx = (box.min.x + box.max.x) / 2;
    if (Math.abs(cx - 120) > 80) return;
    if (box.max.y < 800) return;
    if (box.max.z - box.min.z < 2000) return; // 西侧整段扶手，排除前缘弧上的短柱
    minZ = Math.min(minZ, box.min.z);
  });
  assert.ok(Number.isFinite(minZ), "应找到西侧栏杆");
  assert.ok(Math.abs(minZ - westFront) < 250, `西栏杆北端 ${minZ} 应贴近外沿 ${westFront}`);
  assert.ok(minZ > -1200, "西栏杆不应再伸到 −2980");
});

test("院坪原楼梯洞已填平，辅楼前与右侧通道接到同高梯田", () => {
  const deck = buildCourtyard(mats);
  for (const z of [-4800, -3200, -1400])
    assert.ok(Math.abs(hits(deck, 11000, z)[0].point.y) < 0.01);
  const clear = (a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    const ray = new THREE.Raycaster(a, direction.clone().normalize(), 0, direction.length());
    assert.equal(ray.intersectObject(deck, true).length, 0, "人行通道被护栏封住");
  };
  // 西端外沿约 Z=-200，通道取辅楼前墙稍北，避免穿出新弧。
  clear(new THREE.Vector3(5250, 1000, -50), new THREE.Vector3(480, 1000, -50));
  clear(new THREE.Vector3(480, 1000, -50), new THREE.Vector3(480, 1000, 7000));
  clear(new THREE.Vector3(480, 1000, 7000), new THREE.Vector3(-500, 1000, 7000));
  assert.ok(Math.abs(hits(ground, -500, 7000)[0].point.y) < 0.01);
  const west = contourAt(courtyardFront, 0);
  const east = contourAt(courtyardFront, site.width);
  const mid = contourAt(courtyardFront, 10000);
  assert.ok(Math.abs(west - -200) < 20);
  assert.ok(Math.abs(east - -8600) < 20);
  assert.ok(Math.abs(mid - -5000) < 50);
  // 自 Z=0 水泥边起算：西200、中5000、东8600；后到前总进深 11000／15800／19400
  // 辅楼默认进深 8000、内退 2000：前墙 Z=1600，相对西端外沿约 1800
  assert.ok(Math.abs(site.annex.z - west - 1800) < 20);
  assert.ok(Math.abs(0 - east - 8600) < 20);
  assert.ok(Math.abs(site.oldDepth - west - 11000) < 50);
  assert.ok(Math.abs(site.oldDepth - mid - 15800) < 50);
  assert.ok(Math.abs(site.oldDepth - east - 19400) < 50);
  const midX = 10500;
  const midArc = contourAt(courtyardFront, midX);
  const chord = west + (east - west) * (midX / site.width);
  assert.ok(midArc < chord - 400, "外沿相对弦线外鼓");
  assert.equal(groundHeight(24000, -2000), 0);
});

test("地库前第一田低2米，前方两层砖房所在台地再低1.5米", () => {
  const first = hits(ground, 10000, -9500)[0].point.y;
  const second = hits(ground, 10000, -16500)[0].point.y;
  assert.ok(Math.abs(site.garageFloor - first - 2000) < 0.01);
  assert.ok(Math.abs(first - second - 1500) < 0.01);
  assert.ok(Math.abs(first - frontFieldLevel) < 0.01);
  assert.ok(Math.abs(second - c.frontHouse.y) < 0.01);
  const back = c.frontHouse.z + c.frontHouse.d;
  const lip = contourAt(terraceContours.frontLower, c.frontHouse.x + c.frontHouse.w / 2);
  assert.ok(Math.abs(lip - back - 400) < 80);
});

test("西侧田坎朝远田渐弯不折回，地库下方外沿无局部急折", () => {
  for (const edge of [rightTerraceBreak, terraceContours.sharedFront, terraceContours.frontLower]) {
    const west = edge.filter(([x]) => x <= 0);
    for (let i = 1; i < west.length; i++) {
      assert.ok(west[i][0] > west[i - 1][0], "田坎不能回绕或重复 X");
      assert.ok(west[i][1] <= west[i - 1][1] + .01, "西侧不应先鼓向北再折回南侧");
    }
  }
  const front = terraceContours.frontLower.filter(([x]) => x >= -16000 && x <= c.frontHouse.x);
  for (let i = 1; i < front.length; i++) {
    // 平面长弧的视觉回归阈值，不是田面坡度或施工标准。
    const slope = (front[i][1] - front[i - 1][1]) / (front[i][0] - front[i - 1][0]);
    assert.ok(slope <= .01 && slope > -.75, "下方田坎不应在短段内急折成 S 弯");
  }
  for (let x = -24000; x <= 0; x += 257) {
    assert.ok(contourAt(rightTerraceBreak, x) > contourAt(terraceContours.sharedFront, x) + 1000);
    assert.ok(contourAt(terraceContours.sharedFront, x) > contourAt(terraceContours.frontLower, x) + 1000);
  }
  assert.equal(contourAt(terraceContours.sharedFront, 0), courtyardFront[0][1]);
});

test("新田坎两侧各有唯一田面，渲染高度与地形查询相符", () => {
  const surfaceNames = new Set([
    "辅楼右侧上田·与院坪齐平", "辅楼右侧原田·未开挖",
    "地库外侧弯曲低田", "前方砖房及蓝顶邻房台地",
  ]);
  for (const x of [-20170, -11370, -5630, -670]) {
    for (const edge of [rightTerraceBreak, terraceContours.sharedFront, terraceContours.frontLower]) {
      const bank = contourAt(edge, x);
      for (const offset of [-123, 123]) {
        const z = bank + offset;
        const surfaces = hits(ground, x, z).filter(hit => surfaceNames.has(hit.object.name.split("·").slice(0, -1).join("·")) || surfaceNames.has(hit.object.name));
        assert.equal(surfaces.length, 1, `田面缺口或叠面 @ ${x},${z}`);
        assert.ok(Math.abs(surfaces[0].point.y - groundHeight(x, z)) < .01, `高度不同源 @ ${x},${z}`);
      }
    }
  }
});
