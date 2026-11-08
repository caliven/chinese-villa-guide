import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildL9, buildXingyuan } from "../src/cars";
import { courtyardFront, site } from "../src/data";
import { contourAt, insetContour } from "../src/contours";
import type { Mats } from "../src/primitives";
import { buildSite, clampParkedCar } from "../src/terrain";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  resetVillaParams,
} from "../src/villa-params";
import {
  GARAGE_OUTER_WALL_CENTER_INSET,
  GARAGE_OUTER_WALL_THICKNESS,
} from "../src/garage-layout";
import { surroundings } from "../src/surroundings";

function stubMats(): Mats {
  const keys = [
    "wall", "trim", "stone", "paving", "courtyard", "neighborCourtyard", "courtyardConcrete", "courtyardTile",
    "roof", "villaRoof", "villaRoofJoint", "roofGutter", "relief", "dressedStone", "carvedStone", "carvingInset",
    "carvingDark", "terrace", "terraceEdge", "dark", "wood", "grass", "soil", "metal", "glass", "lowE", "inside",
    "floor", "fabric", "foliage", "trunk", "gold", "marble", "darkStone", "darkStoneGroove", "darkStoneRampMark",
    "sand", "british", "bronze", "bronzeDark", "doorBathFrame", "doorBathGlass", "doorTimber", "doorInset",
    "doorHardware", "doorSeal", "doorBronze", "doorBronzeInset", "doorBronzeHardware",
  ];
  return Object.fromEntries(keys.map((key) => {
    const material = new THREE.MeshStandardMaterial();
    material.name = key;
    return [key, material];
  })) as Mats;
}

test("L9 与星愿模型按厂商公开尺寸落在合理包围盒内", () => {
  const mat = stubMats();
  const l9 = buildL9(mat);
  const xy = buildXingyuan(mat);
  const l9Box = new THREE.Box3().setFromObject(l9);
  const xyBox = new THREE.Box3().setFromObject(xy);
  const l9Size = l9Box.getSize(new THREE.Vector3());
  const xySize = xyBox.getSize(new THREE.Vector3());
  assert.ok(l9Size.z > site.vehicle.length * 0.92 && l9Size.z < site.vehicle.length * 1.12);
  assert.ok(l9Size.x > site.vehicle.width * 0.9 && l9Size.x < site.vehicle.width * 1.25);
  assert.ok(l9Size.y > 1500 && l9Size.y < 2100);
  assert.ok(xySize.z > 3900 && xySize.z < 4400);
  assert.ok(xySize.x > 1650 && xySize.x < 2200);
  assert.ok(xySize.y > 1350 && xySize.y < 1750);
  assert.equal(l9.name, "理想L9");
  assert.equal(xy.name, "吉利星愿");
});

test("L9 前灯与天幕／黑顶不外飘到玻璃或车头之外", () => {
  const mat = stubMats();
  const l9 = buildL9(mat);
  const xy = buildXingyuan(mat);
  const frontLamps = l9.children.filter((child) => {
    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    return child instanceof THREE.Mesh && mat?.emissiveIntensity && mat.emissiveIntensity > 0.5
      && child.position.z < -2000 && child.position.y > 800 && child.position.y < 1000;
  });
  assert.ok(frontLamps.length >= 1, "应有前星环灯");
  for (const lamp of frontLamps) {
    assert.ok(lamp.position.z > -2520, `前灯 z=${lamp.position.z} 应贴合前脸，不能悬在 -2610 外`);
  }
  // 车顶附加件前缘须落在前风挡顶之后（约 z≥-100），避免玻璃上方飘板。
  for (const car of [l9, xy]) {
    for (const child of car.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const box = new THREE.Box3().setFromObject(child);
      const tall = box.max.y > (car === l9 ? 1700 : 1470);
      const flat = box.max.y - box.min.y < 80;
      if (tall && flat && box.getSize(new THREE.Vector3()).z > 400) {
        assert.ok(box.min.z > -200, `${car.name} 顶面件前缘 z=${box.min.z} 不可盖过风挡`);
      }
    }
  }
});

test("两辆停车模型停在自家地库东侧", () => {
  const previous = globalThis.document;
  const ctx = new Proxy({}, {
    get: (_target, prop) => (prop === "measureText" ? () => ({ width: 80 }) : () => undefined),
    set: () => true,
  });
  globalThis.document = {
    createElement: () => ({ width: 256, height: 256, getContext: () => ctx }),
  } as unknown as Document;
  try {
    resetVillaParams();
    const land = buildSite(stubMats());
    const l9 = land.parked;
    const xy = land.second;
    assert.equal(l9.name, "理想L9");
    assert.equal(xy.name, "吉利星愿");
    const mainEast = site.main.x + site.main.w;
    assert.ok(l9.position.x > mainEast, `L9 x=${l9.position.x} 应在主楼东墙 ${mainEast} 以东`);
    assert.ok(xy.position.x > l9.position.x, `星愿应在 L9 更东：${xy.position.x} > ${l9.position.x}`);
    assert.ok(xy.position.x > mainEast + 2000, `星愿 x=${xy.position.x} 应更靠东侧分隔墙`);
    assert.equal(l9.position.y, site.garageFloor);
    assert.equal(xy.position.y, site.garageFloor);
  } finally {
    globalThis.document = previous;
    resetVillaParams();
  }
});

test("院坪东／西进深变浅后停车不穿出弧形外沿", () => {
  resetVillaParams();
  const assertInside = (x: number, z: number, halfW: number, halfD: number, label: string) => {
    const clear = insetContour(
      courtyardFront,
      GARAGE_OUTER_WALL_CENTER_INSET + GARAGE_OUTER_WALL_THICKNESS + 40,
    );
    for (const sx of [x - halfW, x, x + halfW]) {
      const edge = sx <= site.width
        ? contourAt(clear, Math.max(0, Math.min(site.width, sx)))
        : surroundings.neighborYard.z + GARAGE_OUTER_WALL_CENTER_INSET + GARAGE_OUTER_WALL_THICKNESS;
      assert.ok(
        z - halfD >= edge - 1,
        `${label} 车头穿出外沿：z-halfD=${Math.round(z - halfD)} edge=${Math.round(edge)} @x=${sx}`,
      );
    }
  };

  {
    const [x, z] = clampParkedCar(21350, -4000, 1200, 2750);
    assertInside(x, z, 1200, 2750, "默认L9");
  }

  applyVillaParams({
    ...getVillaParams(),
    courtyardEastTotal: getVillaParams().courtyardEastTotal - 2500,
  });
  {
    const [x, z] = clampParkedCar(21350, -4000, 1200, 2750);
    assertInside(x, z, 1200, 2750, "东侧变浅L9");
    const [x2, z2] = clampParkedCar(24700, -3600, 1050, 2200);
    assertInside(x2, z2, 1050, 2200, "东侧变浅星愿");
  }

  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    courtyardEastTotal: DEFAULT_VILLA_PARAMS.courtyardEastTotal - 2000,
    courtyardWestTotal: DEFAULT_VILLA_PARAMS.courtyardWestTotal + 500,
    courtyardMidTotal: DEFAULT_VILLA_PARAMS.courtyardMidTotal - 800,
  });
  {
    const [x, z] = clampParkedCar(21350, -4000, 1200, 2750);
    assertInside(x, z, 1200, 2750, "两端重定弧后L9");
  }
  resetVillaParams();
});
