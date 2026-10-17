import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  floors,
  site,
  annexFurniture,
  annexPartitions,
  carCorners,
  contains,
  polygonArea,
  buildingAreas,
  frontElevation,
  circulation,
  courtyardArcAnchors,
  type Point,
} from "../src/data";
import { buildVilla, mainRoofFootprint, roofPitch } from "../src/architecture";
import { facades } from "../src/facades";
import { sunDirection } from "../src/viewer";
import { diningClearance } from "../src/plan";
import type { Mats } from "../src/primitives";
import { cornerPilasterTopY, eyelidFixed, fasciaBottomY } from "../src/roof-options";
import { frontApronEaveBase } from "../src/facade-details";

test("主辅楼171平方米，21米内包含两侧过道和子孙道，辅楼内退2米", () => {
  assert.equal(site.main.w * site.main.d, 135);
  assert.equal(site.annex.w * site.annex.d, 36);
  assert.equal(site.annex.d, 8);
  assert.equal(site.annex.z - site.main.z, 2);
  assert.equal(buildingAreas.portico, 9.6);
  assert.equal(site.width, 21);
  const eastGap = site.width - site.main.x - site.main.w;
  assert.ok(Math.abs(eastGap - 0.8) < 1e-8);
  assert.ok(Math.abs(site.sideGap - 0.7) < 1e-8);
  assert.ok(
    Math.abs(
      site.sideGap + site.annex.w + site.lane + site.main.w + eastGap - site.width,
    ) < 1e-8,
  );
  assert.ok(Math.abs(site.main.z + site.main.d + site.rearGap - site.oldDepth) < 1e-9);
  assert.ok(Math.abs(site.setback - 1.2) < 1e-9);
  assert.ok(Math.abs(-site.deckStructure - site.garageFloor - 2.5) < 1e-8);
});

test("七间卧室按2/3/2分布，老人房含独卫，主楼无厨房", () => {
  assert.deepEqual(
    floors.map((f) => f.rooms.filter((r) => r.kind === "bed").length),
    [2, 3, 2],
  );
  const elder = floors[0].rooms.find((r) => r.id === "elder")!;
  const bath = floors[0].rooms.find((r) => r.id === "ensuite")!;
  assert.ok(
    bath.x >= elder.x &&
      bath.z >= elder.z &&
      bath.x + bath.w <= elder.x + elder.w &&
      bath.z + bath.d <= elder.z + elder.d,
  );
  assert.ok(!floors.some((f) => f.rooms.some((r) => r.kind === "kitchen")));
  assert.ok(
    floors[1].rooms.some((r) => r.kind === "void" && r.x === site.main.x),
  );
});

test("所有门洞均在实际墙段内", () => {
  for (const wall of [
    ...floors.flatMap((f) => f.partitions),
    ...annexPartitions,
  ]) {
    if (wall.door)
      assert.ok(
        wall.door.offset >= 0 &&
          wall.door.offset + wall.door.width <=
            Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) + 1e-8,
      );
  }
  for (let i = 0; i <= 3; i++)
    for (const wall of facades(i))
      for (const opening of wall.openings) {
        const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        assert.ok(
          opening.at - opening.w / 2 >= 0 &&
            opening.at + opening.w / 2 <= length,
        );
        assert.ok(
          opening.sill + opening.h <= (i === 3 ? 3.6 : floors[i].height),
        );
      }
});

test("卧室、公卫与三楼南过厅都可从公共区通过真实门洞到达", () => {
  // 平面拓扑检查：墙体阻断，门洞开放；不把它当净宽或疏散规范验算。
  for (const [index, f] of floors.entries()) {
    const step = 0.1,
      width = 136,
      depth = 101;
    const walls = f.partitions.flatMap((w) => {
      if (!w.door) return [[w.a, w.b]];
      const dx = w.b[0] - w.a[0],
        dz = w.b[1] - w.a[1],
        length = Math.hypot(dx, dz);
      const at = (n: number): Point => [
        w.a[0] + (dx * n) / length,
        w.a[1] + (dz * n) / length,
      ];
      return [
        [w.a, at(w.door.offset)],
        [at(w.door.offset + w.door.width), w.b],
      ];
    });
    const rearInside = site.main.z + site.main.d - 0.14;
    const inside = (x: number, z: number) =>
      x > 6.94 &&
      x < 20.16 &&
      z > f.front + 0.14 &&
      z < rearInside &&
      !(index === 1 && x < circulation.livingVoid.x + circulation.livingVoid.w + 0.06 && z < circulation.livingVoid.z + circulation.livingVoid.d + 0.02);
    const blocked = (x: number, z: number) =>
      walls.some(([a, b]) => {
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          len2 = dx * dx + dz * dz;
        const t = len2
          ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2))
          : 0;
        return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < 0.068;
      });
    const gridZ0 = site.main.z;
    const id = (x: number, z: number) =>
      Math.round((z - gridZ0) / step) * width + Math.round((x - 6.8) / step);
    const visited = new Set<number>(),
      queue = [id(13.5, site.main.z + 2.5)];
    for (let head = 0; head < queue.length; head++) {
      const value = queue[head];
      if (visited.has(value)) continue;
      const ix = value % width,
        iz = Math.floor(value / width),
        x = 6.8 + ix * step,
        z = gridZ0 + iz * step;
      if (
        ix < 0 ||
        ix >= width ||
        iz < 0 ||
        iz >= depth ||
        !inside(x, z) ||
        blocked(x, z)
      )
        continue;
      visited.add(value);
      queue.push(value - 1, value + 1, value - width, value + width);
    }
    for (const room of f.rooms.filter(
      (r) => r.kind === "bed" || r.kind === "bath" || r.id === "rearHall",
    )) {
      assert.ok(
        visited.has(id(room.x + room.w / 2, room.z + room.d / 2)),
        `${f.name} ${room.name} 被墙封闭`,
      );
    }
  }
});

test("主辅楼屋檐均落在参考地块内，门厅二层没有平台", () => {
  const keys = [
    "wall",
    "trim",
    "stone",
    "paving",
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
    "villaRoof",
    "villaRoofJoint",
    "roofGutter",
    "relief",
    "dressedStone",
    "carvedStone",
    "carvingInset",
    "carvingDark",
    "terrace",
    "terraceEdge",
  ];
  const mats = Object.fromEntries(
    keys.map((key) => [key, new THREE.MeshStandardMaterial()]),
  ) as Mats;
  const villa = buildVilla(mats, false);
  villa.group.updateMatrixWorld(true);
  const v = new THREE.Vector3(),
    transform = new THREE.Matrix4(),
    inst = new THREE.Matrix4();
  const outside: string[] = [];
  // 主楼东檐／辅楼西檐与前檐按统一 0.8 出挑时可略超红线；压顶再外飘 20mm。
  const cope = eyelidFixed.copingOverhang;
  const eastPad = Math.max(0, site.thirdEave - (site.width - site.main.x - site.main.w)) + cope;
  const westPad = Math.max(0, site.thirdEave - site.annex.x) + cope;
  const northPad = Math.max(0, site.thirdEave - (site.annex.z - courtyardArcAnchors[0][1])) + cope;
  const inBounds = (x: number, z: number) => {
    if (contains([x, z], site.boundary)) return true;
    const cx = Math.min(site.width - 1e-4, Math.max(0, x));
    const cz = Math.min(site.oldDepth - 1e-4, Math.max(courtyardArcAnchors[0][1], z));
    return (
      contains([cx, cz], site.boundary)
      && x >= -westPad - 1e-4
      && x <= site.width + eastPad + 1e-4
      && z >= courtyardArcAnchors[0][1] - northPad - 1e-4
    );
  };
  for (const [name, root] of [
    ["mainRoof", villa.roof],
    ["annexRoof", villa.annexRoof],
  ] as const)
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.getAttribute("position");
      for (
        let instance = 0;
        instance < (o instanceof THREE.InstancedMesh ? o.count : 1);
        instance++
      ) {
        transform.copy(o.matrixWorld);
        if (o instanceof THREE.InstancedMesh) {
          o.getMatrixAt(instance, inst);
          transform.multiply(inst);
        }
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(transform);
          if (!inBounds(v.x, v.z)) {
            outside.push(`${name}: ${v.x.toFixed(3)}, ${v.z.toFixed(3)}`);
            break;
          }
        }
      }
    });
  assert.deepEqual(outside.slice(0, 8), []);
  // 中间房间已与两侧齐平，二楼在此有楼板；外伸门厅柱间仍没有二楼平台。
  const ray = new THREE.Raycaster(
    new THREE.Vector3(13.7, 3, site.main.z + 0.5),
    new THREE.Vector3(0, 1, 0),
    0,
    1.0,
  );
  const midFloor = ray.intersectObject(villa.levels[1], true);
  assert.ok(midFloor.length > 0 && midFloor[0].point.y > 3.4 && midFloor[0].point.y < 3.61);
  // 新外伸区同样必须在二层为空、三层有真正可踩的楼板。
  const porchProbeZ = site.main.z - site.portico.projection;
  ray.set(new THREE.Vector3(13.7, 4, porchProbeZ), new THREE.Vector3(0, -1, 0));
  ray.far = 0.8;
  assert.equal(ray.intersectObject(villa.group, true).length, 0);
  ray.set(new THREE.Vector3(13.7, 7.3, porchProbeZ), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(ray.intersectObject(villa.levels[2], true)[0].point.y - 7.2) < 1e-5);
  const approach = villa.group.getObjectByName("门厅柱间三步与两侧坡道")!;
  const approachBounds = new THREE.Box3().setFromObject(approach);
  const columnFront = frontElevation.porticoColumnZ - frontElevation.porticoColumnDepth / 2;
  const westInner = frontElevation.balustradePosts[1].x + frontElevation.balustradePosts[1].w / 2;
  const eastInner = frontElevation.balustradePosts[2].x - frontElevation.balustradePosts[2].w / 2;
  const steps = approach.getObjectByName("柱间三步")!;
  const stepBounds = new THREE.Box3().setFromObject(steps);
  assert.ok(stepBounds.min.z < columnFront - 0.5, "台阶应伸到门厅柱前面");
  assert.ok(stepBounds.min.x > westInner - 0.02 && stepBounds.max.x < eastInner + 0.02, "三步应嵌在两根门厅柱中间");
  const westOuter = frontElevation.balustradePosts[1].x - frontElevation.balustradePosts[1].w / 2;
  const eastOuter = frontElevation.balustradePosts[2].x + frontElevation.balustradePosts[2].w / 2;
  assert.ok(approachBounds.min.z > -5, "坡道不应伸向院坪栏杆");
  assert.ok(approachBounds.min.x < westOuter - 1.5 && approachBounds.min.x > westOuter - 2.4, "西侧坡道缩短到约2米");
  assert.ok(approachBounds.max.x > eastOuter + 1.5 && approachBounds.max.x < eastOuter + 2.4, "东侧坡道缩短到约2米");
  assert.ok(approach.getObjectByName("坡道防滑条"), "坡道应有防滑横条");
  const eastOuterFace = frontElevation.balustradePosts[2].x + frontElevation.balustradePosts[2].w / 2;
  const eastRamp = approach.getObjectByName("东侧坡道")!;
  const fromNorth = new THREE.Raycaster(
    new THREE.Vector3(eastOuterFace + 1, 0.22, columnFront - 1.2),
    new THREE.Vector3(0, 0, 1),
  );
  const sideHit = fromNorth.intersectObject(eastRamp, true)[0];
  assert.ok(sideHit, "东侧坡道北侧面应能挡住视线");
  const fromAbove = new THREE.Raycaster(
    new THREE.Vector3(eastOuterFace + 1, 2, columnFront + 0.8),
    new THREE.Vector3(0, -1, 0),
  );
  assert.ok(fromAbove.intersectObject(eastRamp, true).length > 0, "东侧坡道顶面应封闭");
  assert.ok(Math.abs(approachBounds.max.y - site.entranceRise) < 0.03);
  const porch = villa.levels[2].getObjectByName("外伸门厅三楼平台")!;
  // 平台北缘与门厅柱／中间短柱同轴后的露台外皮对齐。
  assert.ok(Math.abs(new THREE.Box3().setFromObject(porch).min.z - frontElevation.centerFront) < 1e-5);
  const lowerEave = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
  // 前凸门厅同样出檐；外缘线脚和瓦垄另有不到5cm的建模厚度。
  const lowerEaveBounds = new THREE.Box3().setFromObject(lowerEave);
  assert.ok(Math.abs(lowerEaveBounds.min.z - (frontElevation.centerFront - site.secondFrontEave)) < 0.05);
  const frontCorners: THREE.Object3D[] = [];
  villa.group.traverse((object) => {
    if (object.name === "包角柱" && object.position.y < 1 && object.position.z < 0) frontCorners.push(object);
  });
  assert.equal(frontCorners.length, 2);
  // 正面一二层包角柱顶：二楼前檐下沿线底以下约10厘米，不通到三眼皮／天沟。
  const frontApronBase = frontApronEaveBase(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
  const frontExpect = cornerPilasterTopY(frontApronBase);
  const frontFasciaBot = fasciaBottomY(frontApronBase, 0);
  for (const column of frontCorners) {
    const top = new THREE.Box3().setFromObject(column).max.y;
    assert.ok(Math.abs(top - frontExpect) < 1e-4, `包角柱顶 ${top} 应为 ${frontExpect}`);
    assert.ok(frontFasciaBot - top > 0.09 && frontFasciaBot - top < 0.12, "柱顶到下沿线底约10厘米");
    // 下沿线／梁托也在飘檐分组内，不能用整组 AABB；柱顶须低于三眼皮底。
    assert.ok(top < frontApronBase - eyelidFixed.rises[0] - eyelidFixed.rises[1] - eyelidFixed.rises[2] - 0.25, "柱顶须明显低于挑檐三眼皮底");
  }
  // 屋后与三楼包角柱：正屋天沟下沿线底以下约10厘米。
  const mainExpect = cornerPilasterTopY(mainRoofFootprint().eave);
  const mainFasciaBot = fasciaBottomY(mainRoofFootprint().eave, 0);
  const highCorners: THREE.Object3D[] = [];
  villa.group.traverse((object) => {
    if (object.name !== "包角柱") return;
    const top = new THREE.Box3().setFromObject(object).max.y;
    if (top > 8) highCorners.push(object);
  });
  assert.ok(highCorners.length >= 2, "屋后应有通高包角柱");
  for (const column of highCorners) {
    const top = new THREE.Box3().setFromObject(column).max.y;
    assert.ok(Math.abs(top - mainExpect) < 1e-4, `高包角柱顶 ${top} 应为 ${mainExpect}`);
    assert.ok(mainFasciaBot - top > 0.09 && mainFasciaBot - top < 0.12);
  }
  const mainGutter = villa.roof.children[0];
  const bounds = new THREE.Box3().setFromObject(mainGutter);
  const mainRoof = mainRoofFootprint();
  assert.ok(Math.abs(bounds.min.x - (mainRoof.x - cope)) < 1e-4);
  assert.ok(Math.abs(bounds.max.x - (mainRoof.x + mainRoof.w + cope)) < 1e-4);
  // 东檐按 thirdEave 统一出挑；墙至界 0.7 时外缘略超地块东界。
  assert.ok(Math.abs(mainRoof.x + mainRoof.w - (site.main.x + site.main.w + site.thirdEave)) < 1e-8);
  assert.ok(Math.abs(mainRoof.z + mainRoof.d - (site.main.z + site.main.d + site.thirdEave)) < 1e-8);
  assert.ok(Math.abs(bounds.min.z - (frontElevation.hatFront - cope)) < 1e-4);
  assert.ok(mainGutter.getObjectByName("天沟槽底"));
  assert.ok(mainGutter.getObjectByName("天沟外挡边"));
  const crown = villa.roof.getObjectByName("中央官帽")!;
  const crownBounds = new THREE.Box3().setFromObject(crown);
  const pitch = roofPitch(site.roofFenShui);
  assert.ok(Math.abs(pitch.mainRise - site.roofRise) < 1e-6);
  assert.ok(bounds.max.y > 10.5 + pitch.mainRise);
  const steeper = buildVilla(mats, false, 6);
  assert.ok(new THREE.Box3().setFromObject(steeper.roof).max.y > bounds.max.y + 0.5);
  assert.ok(Math.abs(crownBounds.max.y - bounds.max.y) < 0.03, `官帽脊 ${crownBounds.max.y} 与正屋脊 ${bounds.max.y} 未齐平`);
  assert.ok(crownBounds.min.z < floors[2].front - 0.8 - 1, "官帽瓦面应比两侧前檐更靠前");
  const leftTerrace = villa.levels[2].getObjectByName("三楼左侧露台")!;
  const rightTerrace = villa.levels[2].getObjectByName("三楼右侧露台")!;
  const leftBox = new THREE.Box3().setFromObject(leftTerrace);
  const rightBox = new THREE.Box3().setFromObject(rightTerrace);
  const centerBox = new THREE.Box3().setFromObject(porch);
  assert.ok(Math.abs(leftBox.max.x - centerBox.min.x) < 0.02);
  assert.ok(Math.abs(centerBox.max.x - rightBox.min.x) < 0.02);
  assert.equal(villa.levels[2].getObjectByName("三楼两端贴墙角柱"), undefined, "三楼左右墙角不再做装饰柱");
  assert.ok(villa.levels[2].getObjectByName("三楼官帽柱"), "三楼官帽柱应保留");
  // 柱身进深 0.5 m、中心在前墙外皮以南 0.25 m → 柱身北皮与一层前墙外皮同面。
  assert.ok(Math.abs(frontElevation.postZ - (site.main.z + 0.25)) < 1e-9);
  assert.ok(villa.annexRoof.getObjectByName("天沟槽底"));
  assert.ok(villa.annexRoof.getObjectByName("天沟外挡边"));
});

test("低田边界保持异形，车辆尺寸不把车身宽冒充含镜宽", () => {
  assert.ok(polygonArea(site.field) < site.width * 8.6);
  assert.equal(site.vehicle.length, 5.218);
  assert.equal(site.vehicle.width, 1.998);
  const c = carCorners(0, 0, 0);
  assert.ok(Math.abs(polygonArea(c) - 5.218 * 1.998) < 1e-9);
  assert.ok(
    Math.abs(polygonArea(carCorners(0, 0, Math.PI / 3)) - polygonArea(c)) <
      1e-9,
  );
  assert.ok(polygonArea(carCorners(0, 0, 0, 0.12)) > polygonArea(c));
});

test("双桌18座均在辅楼内，拉椅空间不足被保留为真实问题", () => {
  assert.equal(annexFurniture.filter((f) => f.kind === "chair").length, 18);
  for (const f of annexFurniture.filter((f) => f.kind === "chair")) {
    assert.ok(f.x - f.w / 2 >= 1.04 && f.x + f.w / 2 <= 5.06);
    assert.ok(f.z - f.d / 2 >= site.annex.z - 0.76 && f.z + f.d / 2 <= site.annex.z + site.annex.d - 2.71);
  }
  assert.ok(diningClearance().east < 0.6);
});

test("太阳使用北京时间、北起顺时针度数，四季结果符合当地季节方向", () => {
  const winter = sunDirection("2026-12-22", 12.5),
    summer = sunDirection("2026-06-21", 12.5);
  assert.ok(winter.altitude > 30 && winter.altitude < 42);
  assert.ok(summer.altitude > 80 && summer.altitude < 90);
  assert.ok(winter.vector.z > 0 && summer.vector.z > 0);
  assert.ok(sunDirection("2026-03-20", 9).vector.x > 0);
  assert.ok(sunDirection("2026-03-20", 16).vector.x < 0);
});
