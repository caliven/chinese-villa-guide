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
  type Point,
} from "../src/data";
import { buildVilla } from "../src/architecture";
import { facades } from "../src/facades";
import { sunDirection } from "../src/viewer";
import { diningClearance } from "../src/plan";
import type { Mats } from "../src/primitives";

test("主辅楼180平方米，21.1米内包含两侧过道和子孙道", () => {
  assert.equal(site.main.w * site.main.d, 135);
  assert.equal(site.annex.w * site.annex.d, 45);
  assert.equal(buildingAreas.portico, 9.6);
  assert.ok(
    Math.abs(
      site.main.w + site.annex.w + 2 * site.sideGap + site.lane - site.width,
    ) < 1e-8,
  );
  assert.equal(site.main.z + site.main.d + site.rearGap, site.oldDepth);
  assert.equal(floors[2].front - floors[0].front, 1.8);
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
    const inside = (x: number, z: number) =>
      x > 6.94 &&
      x < 20.16 &&
      z > f.front + 0.14 &&
      z < 8.86 &&
      !(index === 1 && x < 11.46 && z > 2.94);
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
    const id = (x: number, z: number) =>
      Math.round((z + 1) / step) * width + Math.round((x - 6.8) / step);
    const visited = new Set<number>(),
      queue = [id(15.6, 2.1)];
    for (let head = 0; head < queue.length; head++) {
      const value = queue[head];
      if (visited.has(value)) continue;
      const ix = value % width,
        iz = Math.floor(value / width),
        x = 6.8 + ix * step,
        z = -1 + iz * step;
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
    "inside",
    "floor",
    "fabric",
    "foliage",
    "trunk",
    "gold",
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
          if (!contains([v.x, v.z], site.boundary)) {
            outside.push(`${name}: ${v.x.toFixed(3)}, ${v.z.toFixed(3)}`);
            break;
          }
        }
      }
    });
  assert.deepEqual(outside.slice(0, 8), []);
  // 中间房间已与两侧齐平，二楼在此有楼板；外伸门厅柱间仍没有二楼平台。
  const ray = new THREE.Raycaster(
    new THREE.Vector3(13.7, 3, -0.5),
    new THREE.Vector3(0, 1, 0),
    0,
    1.0,
  );
  const midFloor = ray.intersectObject(villa.levels[1], true);
  assert.ok(midFloor.length > 0 && midFloor[0].point.y > 3.4 && midFloor[0].point.y < 3.61);
  // 新外伸区同样必须在二层为空、三层有真正可踩的楼板。
  ray.set(new THREE.Vector3(13.7, 4, -2), new THREE.Vector3(0, -1, 0));
  ray.far = 0.8;
  assert.equal(ray.intersectObject(villa.group, true).length, 0);
  ray.set(new THREE.Vector3(13.7, 7.3, -2), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(ray.intersectObject(villa.levels[2], true)[0].point.y - 7.2) < 1e-5);
  const porch = villa.levels[2].getObjectByName("外伸门厅三楼平台")!;
  // 平台北缘收进 4cm，侧边不再和檐口外皮共面。
  assert.ok(Math.abs(new THREE.Box3().setFromObject(porch).min.z - (site.main.z - 2 + 0.04)) < 1e-5);
  const lowerEave = villa.levels[2].getObjectByName("二楼前飘檐70厘米")!;
  assert.ok(Math.abs(new THREE.Box3().setFromObject(lowerEave).min.z - (site.main.z - .7)) < 1e-5);
  const mainGutter = villa.roof.children[0];
  const bounds = new THREE.Box3().setFromObject(mainGutter);
  assert.ok(Math.abs(bounds.min.x - (site.main.x - .8)) < 1e-5);
  assert.ok(Math.abs(bounds.max.x - (site.main.x + site.main.w + .8)) < 1e-5);
  assert.ok(Math.abs(bounds.min.z - (floors[2].front - .8)) < 1e-5);
  assert.ok(mainGutter.getObjectByName("天沟槽底"));
  assert.ok(mainGutter.getObjectByName("天沟外挡边"));
  const crown = villa.roof.getObjectByName("中央官帽")!;
  assert.ok(new THREE.Box3().setFromObject(crown).max.y <= bounds.max.y + 1e-4);
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
    assert.ok(f.z - f.d / 2 >= -0.76 && f.z + f.d / 2 <= 5.29);
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
