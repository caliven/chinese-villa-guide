import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  defaultTerrainHorizon, horizonElevationDeg, normalizeAzimuthDeg,
  sunClearsHorizon, sunHorizonLightFactor, buildDistantTerrain, handmadeHouseCenterMm,
  terrainHeightM, terrainHorizonProfile, horizonFromProfile, horizonAtObserver,
  modelPointToTerrain, type TerrainHorizonData,
  terrainPointToModel,
} from "../src/terrain-horizon.ts";
import { sunWindowProbes, southWindowProbes } from "../src/design-data.ts";
import type { Mats } from "../src/primitives.ts";
import { applyVillaParams, getVillaParams, resetVillaParams } from "../src/villa-params.ts";
import { site } from "../src/data.ts";
import { sunDirection, VillaViewer, defaultView } from "../src/viewer.ts";
import { sunOcclusion } from "../src/sun-occlusion.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { handmadeTerrainBounds, terrainAnalysisData, createJoinedTerrainSampler, TERRAIN_JOIN_WIDTH_MM, terraceContours } from "../src/surroundings.ts";
import { buildContextGround, buildRoad } from "../src/site-ground.ts";
import { contourAt } from "../src/contours.ts";

test.afterEach(resetVillaParams);

function syntheticTerrain(): TerrainHorizonData {
  const coordinatesM = [-400, -200, 0, 200, 400];
  return {
    ...defaultTerrainHorizon, radiusM: 400, nearSkipM: 150, reference: undefined, localModelBoundsMm: undefined,
    grid: {
      extentM: 400, stepM: 200, rows: 5, cols: 5, holeRadiusM: 150, coordinatesM,
      relativeHeightM: coordinatesM.flatMap(() => [0, 0, 0, 30, 50]),
    },
  };
}

test("发布数据与分析同源，保留真实瓦片来源、原始高程和实际覆盖范围", () => {
  const data = defaultTerrainHorizon;
  const publicData = JSON.parse(readFileSync(new URL("../public/terrain/horizon.json", import.meta.url), "utf8"));
  assert.deepEqual(publicData, data);
  assert.equal(data.version, 3);
  assert.equal(data.latitude, site.latitude);
  assert.equal(data.longitude, site.longitude);
  assert.ok(data.tiles?.some(tile => tile.imagerySources === "srtm/N28E111.tif"));
  assert.ok(data.tiles?.every(tile => tile.sha256.length === 64 && tile.url.startsWith("https://elevation-tiles-prod.s3.amazonaws.com/")));
  assert.equal(data.grid?.heightMode, "raw-dem-local-tangent");
  assert.equal(data.radiusM, data.grid?.extentM);
  assert.equal(data.elevationDeg.length, 360 / data.binDeg);
  assert.equal(data.grid?.relativeHeightM.length, data.grid!.cols * data.grid!.rows);
  assert.ok(data.grid!.relativeHeightM.every(Number.isFinite));
  assert.ok(data.grid!.relativeHeightM.some(height => height > 520), "真实高山不得裁到旧版520m上限");
  assert.ok(data.grid!.relativeHeightM.some(height => height < -80), "低地不得裁到旧版-80m下限");
  assert.ok(Math.abs(terrainHeightM(0, 0)!) < 0.001);
  assert.equal(data.reference?.elevationMeasured, false);
  assert.equal(data.reference?.orientationMeasured, false);
  assert.deepEqual(data.localModelBoundsMm, terrainAnalysisData().localModelBoundsMm);
});

test("近场与DEM在同一外沿交接，取消旧100～250m空缺", () => {
  const bounds = handmadeTerrainBounds(), data = terrainAnalysisData();
  const anchor = handmadeHouseCenterMm();
  const observer = modelPointToTerrain(anchor.x, 5000, anchor.z);
  const south = terrainHorizonProfile(180, observer, data);
  const start = Math.min(...south.map(point => point.distanceM));
  assert.ok(Math.abs(start - (bounds.back + TERRAIN_JOIN_WIDTH_MM - anchor.z) / 1000) < 1e-8);
  assert.ok(start < 100);
  const outsideX = bounds.right + TERRAIN_JOIN_WIDTH_MM;
  const outside = modelPointToTerrain(outsideX, 0, anchor.z);
  assert.equal(createJoinedTerrainSampler()(outsideX, anchor.z), terrainHeightM(outside.eastM, outside.northM));
  const group = buildDistantTerrain({} as Mats);
  const join = group.getObjectByName("DEM近场衔接面") as THREE.Mesh;
  assert.ok(join.castShadow);
  const far = group.getObjectByName("DEM山体曲面") as THREE.Mesh;
  const farIndices = far.geometry.getIndex()!, points = far.geometry.getAttribute("position");
  const local = data.localModelBoundsMm!;
  for (let i = 0; i < farIndices.count; i += 3) {
    const ids = [farIndices.getX(i), farIndices.getX(i + 1), farIndices.getX(i + 2)];
    const x = ids.reduce((sum, id) => sum + points.getX(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + points.getZ(id), 0) / 3;
    assert.ok(x < local.left || x > local.right || z < local.front || z > local.back);
  }
});

test("方位角归一化与跨北向插值连续，实际计算按精确方位追踪三角网", () => {
  assert.equal(normalizeAzimuthDeg(-90), 270);
  assert.equal(normalizeAzimuthDeg(360), 0);
  assert.equal(horizonElevationDeg(90.75), (horizonElevationDeg(90.5) + horizonElevationDeg(91)) / 2);
  assert.ok(Math.abs(horizonElevationDeg(-0.0001) - horizonElevationDeg(0.0001)) < 0.01);
  for (let azimuth = 0; azimuth < 360; azimuth += 7.5) {
    assert.ok(Math.abs(horizonAtObserver(azimuth, { eastM: 0, northM: 0, heightM: 0 }) - horizonElevationDeg(azimuth)) < 0.00006);
  }
});

test("衔接带跨越田坎标高突变时连续，外沿严格回到原始DEM", () => {
  const bounds = handmadeTerrainBounds(), sample = createJoinedTerrainSampler();
  const station = contourAt(terraceContours.leftPlatform, bounds.right);
  const x = bounds.right + 5000;
  assert.ok(Math.abs(sample(x, station - 0.1) - sample(x, station + 0.1)) < 0.001);
  for (let z = bounds.front; z <= bounds.back; z += 2500) {
    const eastX = bounds.right + TERRAIN_JOIN_WIDTH_MM;
    const p = modelPointToTerrain(eastX, 0, z);
    assert.equal(sample(eastX, z), terrainHeightM(p.eastM, p.northM));
    assert.ok(Math.abs(sample(eastX - 0.1, z) - sample(eastX, z)) < 0.001);
  }
});

test("近场衔接使用细分三角面，消除大网格把田坎向外拉成尖角", () => {
  const mesh = buildDistantTerrain({} as Mats).getObjectByName("DEM近场衔接面") as THREE.Mesh;
  const p = mesh.geometry.getAttribute("position");
  assert.ok(p.count > 300);
  for (let i = 0; i < p.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = i + j, b = i + (j + 1) % 3;
      assert.ok(Math.hypot(p.getX(a) - p.getX(b), p.getZ(a) - p.getZ(b)) < 2900);
    }
  }
});

test("田坎与DEM洞缘之间的高差由实体收边封闭，并参与日照遮挡", () => {
  const material = new THREE.MeshStandardMaterial();
  const mats = { grass: material, soil: material, paving: material, neighborCourtyard: material } as Mats;
  const local = new THREE.Group();
  local.add(buildContextGround(mats), buildRoad(mats));
  const terrain = buildDistantTerrain(mats, defaultTerrainHorizon, local);
  const surface = terrain.getObjectByName("DEM近场衔接面") as THREE.Mesh;
  const closure = terrain.getObjectByName("近场接缝竖向收边") as THREE.Mesh;
  assert.ok(closure?.castShadow);
  const bounds = handmadeTerrainBounds();
  const down = new THREE.Raycaster(), across = new THREE.Raycaster();
  let checked = 0;
  const borders = [
    { axis: "z", fixed: bounds.left, start: bounds.front, end: bounds.back, outward: new THREE.Vector3(-1, 0, 0) },
    { axis: "z", fixed: bounds.right, start: bounds.front, end: bounds.back, outward: new THREE.Vector3(1, 0, 0) },
    { axis: "x", fixed: bounds.front, start: bounds.left, end: bounds.right, outward: new THREE.Vector3(0, 0, -1) },
    { axis: "x", fixed: bounds.back, start: bounds.left, end: bounds.right, outward: new THREE.Vector3(0, 0, 1) },
  ];
  for (const border of borders) {
    for (let station = border.start + 250; station < border.end; station += 250) {
      const point = border.axis === "z" ? new THREE.Vector3(border.fixed, 100000, station) : new THREE.Vector3(station, 100000, border.fixed);
      down.set(point.clone().addScaledVector(border.outward, 1), new THREE.Vector3(0, -1, 0));
      const visible = down.intersectObject(surface)[0];
      assert.ok(visible, `DEM洞缘缺面 @ ${point.x},${point.z}`);
      down.set(point.clone().addScaledVector(border.outward, -1), new THREE.Vector3(0, -1, 0));
      const manual = down.intersectObject(local, true)[0];
      assert.ok(manual, `近场外沿缺面 @ ${point.x},${point.z}`);
      if (Math.abs(visible.point.y - manual.point.y) < 50) continue;
      const origin = point.clone().addScaledVector(border.outward, 100);
      origin.y = (visible.point.y + manual.point.y) / 2;
      across.set(origin, border.outward.clone().negate());
      across.far = 200;
      assert.ok(across.intersectObject(closure).length, `接缝未封闭 @ ${point.x},${point.z}`);
      checked++;
    }
  }
  assert.ok(checked > 10);
});

test("DEM裁洞保留原三角面平面，网格边界无T形裂缝", () => {
  const group = buildDistantTerrain({} as Mats);
  const mesh = group.getObjectByName("DEM近场衔接面") as THREE.Mesh;
  const ray = new THREE.Raycaster();
  const height = (east: number, north: number) => {
    const p = terrainPointToModel(east, north, 100);
    ray.set(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(mesh)[0]?.point.y;
  };
  let checked = 0;
  for (let line = -60; line <= 60; line += 10) {
    for (let station = -60; station <= 60; station += 5) {
      for (const [a, b] of [
        [height(line - 0.0001, station), height(line + 0.0001, station)],
        [height(station, line - 0.0001), height(station, line + 0.0001)],
      ]) {
        if (a == null || b == null) continue;
        assert.ok(Math.abs(a - b) < 1, `网格边缘断开 @ ${line},${station} / ${a},${b}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 40);
});

test("太阳中心遮挡与太阳圆盘照明口径明确，遮全时直射为零", () => {
  const ridge = horizonElevationDeg(120);
  assert.equal(sunClearsHorizon(ridge, 120), false);
  assert.equal(sunClearsHorizon(ridge + 0.01, 120), true);
  assert.equal(sunClearsHorizon(-1, 120), false);
  assert.equal(sunHorizonLightFactor(ridge - 0.3, 120), 0);
  assert.equal(sunHorizonLightFactor(ridge + 0.3, 120), 1);
  assert.ok(Math.abs(sunHorizonLightFactor(ridge, 120) - 0.5) < 1e-10);
});

test("完整DEM参与逐高度投影，5m参考点被挡时保留上层接收太阳光的能力", () => {
  const group = buildDistantTerrain({} as Mats);
  const mesh = group.getObjectByName("DEM山体曲面") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.material.shadowSide, THREE.DoubleSide);
  const sun = new THREE.DirectionalLight();
  const viewer = { sun, renderer: { shadowMap: { needsUpdate: false } }, applyLighting() {}, daySunIntensity: 0, dayAmbientIntensity: 0 };
  const result = VillaViewer.prototype.setSun.call(viewer as unknown as VillaViewer, "2026-12-22", 8);
  assert.ok(result.altitude > 0);
  assert.equal(result.horizonFactor, 0);
  assert.ok(viewer.daySunIntensity > 0, "遮挡交给真实山体投影，避免用5m参考值把整栋主光关掉");
  assert.ok(Math.abs(sun.position.distanceTo(sun.target.position) - 22000) < 1e-6);
});

test("观察点变高时重新比较所有山脊，不能只修正院坪的单个最高点", () => {
  const data = syntheticTerrain();
  const observer = { eastM: 0, northM: 0, heightM: 0 };
  const profile = terrainHorizonProfile(90, observer, data);
  const lower = horizonFromProfile(profile, 0), upper = horizonFromProfile(profile, 20);
  assert.ok(Math.abs(lower.elevationDeg - Math.atan(30 / 200) * 180 / Math.PI) < 1e-8);
  assert.ok(Math.abs(upper.elevationDeg - Math.atan(30 / 400) * 180 / Math.PI) < 1e-8);
  assert.ok(lower.distanceM >= 150 && lower.distanceM <= 200);
  assert.equal(upper.distanceM, 400);
  const nearer = horizonAtObserver(90, { eastM: 100, northM: 0, heightM: 20 }, data);
  assert.ok(Math.abs(nearer - Math.atan(10 / 100) * 180 / Math.PI) < 1e-8);
});

test("高程采样采用实际三角面，越界返回缺测", () => {
  const data = syntheticTerrain();
  data.grid = { extentM: 100, stepM: 200, cols: 2, rows: 2, holeRadiusM: 0, relativeHeightM: [0, 0, 0, 100] };
  assert.equal(terrainHeightM(50, -50, data), 25);
  assert.equal(terrainHeightM(-50, 50, data), 25);
  assert.equal(terrainHeightM(101, 0, data), null);
});

test("地理锚点固定，改变新房宽深和主辅楼换位保持山体定位", () => {
  const before = { ...handmadeHouseCenterMm() };
  const mapped = modelPointToTerrain(before.x + 2000, 5000, before.z - 3000);
  assert.deepEqual(mapped, { eastM: 2, northM: 3, heightM: 5 });
  const params = getVillaParams();
  applyVillaParams({ ...params, mainWidth: 14000, mainDepth: 11000 });
  assert.deepEqual(handmadeHouseCenterMm(), before);
  applyVillaParams({ ...params, buildingPlacement: "main-west" });
  assert.deepEqual(handmadeHouseCenterMm(), before);
  const rotated = structuredClone(defaultTerrainHorizon);
  rotated.reference!.modelNorthAzimuthDeg = 90;
  const east = modelPointToTerrain(before.x, 1000, before.z - 1000, rotated);
  assert.ok(Math.abs(east.eastM - 1) < 1e-8);
  assert.ok(Math.abs(east.northM) < 1e-8);
  const inverse = terrainPointToModel(east.eastM, east.northM, east.heightM, rotated);
  assert.ok(Math.abs(inverse.x - before.x) < 1e-8);
  assert.ok(Math.abs(inverse.z - before.z + 1000) < 1e-8);
});

test("各层四向外窗均有采样，旧南窗接口保持一二层兼容", () => {
  const all = sunWindowProbes();
  assert.deepEqual([...new Set(all.map(probe => probe.facing))].sort(), ["east", "north", "south", "west"]);
  assert.ok(all.some(probe => probe.floorIndex === 2 && probe.facing === "south"));
  assert.ok(all.some(probe => probe.floorIndex === 3 && probe.name.startsWith("辅楼")));
  const expected = resolveLayoutFacades().facades.flatMap(faces => faces.flatMap(face => face.openings)).filter(o => !o.door && o.w > 0 && o.h > 0).length;
  assert.equal(all.length, expected, "每个真实窗洞都应有探针");
  const south = southWindowProbes();
  assert.equal(south.length, 4);
  assert.deepEqual(south, all.filter(probe => probe.facing === "south" && probe.floorIndex < 2 && probe.widthMm > 1500));
  for (const probe of all) assert.equal(Math.hypot(probe.outward.x, probe.outward.y, probe.outward.z), 1);
});

test("可见山体与分析共用远场三角网，近场衔接不改写原始DEM", () => {
  const before = JSON.stringify(defaultTerrainHorizon);
  const group = buildDistantTerrain({} as Mats);
  const mesh = group.children[0] as THREE.Mesh;
  assert.equal(group.name, "SRTM地形");
  const origin = handmadeHouseCenterMm();
  const ray = new THREE.Raycaster();
  ray.near = 200000;
  ray.far = 20000000;
  for (const azimuth of [0, 37, 90, 151, 180, 247, 270, 329]) {
    const observer = { eastM: 0, northM: 0, heightM: 5 };
    const az = azimuth * Math.PI / 180;
    const profile = terrainHorizonProfile(azimuth, observer).filter(point => point.distanceM >= 200);
    profile.push({ distanceM: 200, heightM: terrainHeightM(200 * Math.sin(az), 200 * Math.cos(az))! });
    const ridge = horizonFromProfile(profile, 5).elevationDeg;
    for (const [offset, blocked] of [[-0.02, true], [0.02, false]] as const) {
      const az = azimuth * Math.PI / 180, alt = (ridge + offset) * Math.PI / 180;
      ray.near = 200000 / Math.cos(alt);
      ray.far = 20000000 / Math.cos(alt);
      ray.set(new THREE.Vector3(origin.x, 5000, origin.z), new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)));
      const belowSurfaceAtStart = 5 + 200 * Math.tan(alt) < terrainHeightM(200 * Math.sin(az), 200 * Math.cos(az))!;
      assert.equal(belowSurfaceAtStart || ray.intersectObject(mesh).length > 0, blocked, `${azimuth}° / ${offset}°`);
    }
  }
  assert.equal(JSON.stringify(defaultTerrainHorizon), before);
});

test("日照包围盒树与原生射线一致，保留实例变换、材质正反面与距离限制", () => {
  const root = new THREE.Group();
  root.scale.setScalar(0.001);
  const box = new THREE.BoxGeometry(1000, 1000, 1000);
  const instances = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), 16);
  for (let i = 0; i < instances.count; i++) instances.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i % 4) * 3000, 1000, 5000 + Math.floor(i / 4) * 3000));
  root.add(instances);
  const backside = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  backside.position.set(0, 0, 20000);
  root.add(backside);
  root.updateMatrixWorld(true);
  const meshes = [instances, backside];
  const blocked = sunOcclusion(meshes);
  for (const far of [2, 10, 30]) {
    for (const x of [-3, 0, 3, 6, 9, 12]) {
      for (const y of [0, 1, 4]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 0), new THREE.Vector3(0, 0, 1), 0, far);
        assert.equal(blocked(ray), ray.intersectObjects(meshes, false).length > 0, `${x},${y},${far}`);
      }
    }
  }
  assert.equal(sunOcclusion([])(new THREE.Raycaster()), false);
});

test("北京时间与SunCalc 2度数／北起方位约定吻合，夏季早晚纳入分析时段", () => {
  const morning = sunDirection("2026-06-21", 6), noon = sunDirection("2026-12-21", 12.5), evening = sunDirection("2026-06-21", 19);
  assert.ok(morning.altitude > 0 && morning.vector.x > 0);
  assert.ok(evening.altitude > 0 && evening.vector.x < 0);
  assert.ok(noon.vector.z > 0 && Math.abs(noon.azimuth - 180) < 5);
  assert.ok(Math.abs(noon.vector.length() - 1) < 1e-8);
});

test("日照分析异常时也恢复视图状态", () => {
  const state = { ...defaultView, existing: true, roof: false };
  const group = new THREE.Group();
  group.traverseVisible = () => { throw new Error("模拟几何读取失败"); };
  const viewer = {
    state: { ...state }, layoutLive: null, scene: new THREE.Scene(),
    villa: { group, balcony: new THREE.Group() },
    land: { context: new THREE.Group(), fixed: new THREE.Group(), deck: new THREE.Group(), neighborDeck: new THREE.Group() },
    setState(next: object) { Object.assign(this.state, next); },
  };
  assert.throws(() => VillaViewer.prototype.analyzeSun.call(viewer as unknown as VillaViewer, "2026-12-21"), /模拟几何/);
  assert.deepEqual(viewer.state, state);
});

test("日照比较保留当前官帽造型，避免按默认屋顶计算遮挡", () => {
  const draft = clonePublishedLayout();
  draft.exteriorOpenings = [];
  const roofStyle = "joined" as const;
  const applied: Partial<typeof defaultView>[] = [];
  const viewer = {
    state: { ...defaultView, roofStyle }, layoutLive: draft, scene: new THREE.Scene(),
    villa: { group: new THREE.Group(), balcony: new THREE.Group() },
    land: { context: new THREE.Group(), fixed: new THREE.Group(), deck: new THREE.Group(), neighborDeck: new THREE.Group() },
    setState(next: Partial<typeof defaultView>) { applied.push(next); Object.assign(this.state, next); },
  };
  VillaViewer.prototype.analyzeSun.call(viewer as unknown as VillaViewer, "2026-12-21");
  assert.ok(applied.every(state => state.roofStyle === roofStyle));
  assert.equal(applied[0].frontNeighbor, true);
});
