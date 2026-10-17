import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { contains, frontElevation, site, type Point } from "../src/data";
import { attachRoofs, floatingHatLayout, mainRoofFootprint, annexRoofFootprint, roofPitch } from "../src/architecture";
import { corbelCentersOnEdge, gutteredRoof, meander, tiledApron } from "../src/facade-details";
import { addTiledRoof, hatRoofSurfaces, hipRoofSurfaces, joinRoofFaces } from "../src/roof-surfaces";
import type { Mats } from "../src/primitives";
import {
  apronFasciaBottom,
  eaveTrimDesign,
  eyelidStackHeight,
  roofGutterDesign,
  roofTileEaveLift,
  roofTileInset as inset,
} from "../src/roof-options";
import { wallWithOpenings } from "../src/primitives";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});

function topHits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  const surfaces: THREE.Object3D[] = [];
  root.traverse(object => { if (object.name === "封闭瓦面") surfaces.push(object); });
  return new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0))
    .intersectObjects(surfaces, false).filter(hit => (hit.face?.normal.y ?? 0) > 0.01);
}

test("改天沟外侧／内侧高度与瓦至内挡顶间距后挡墙与瓦檐跟着变", async () => {
  const { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } = await import("../src/villa-params");
  const wallSpan = (root: THREE.Object3D, name: string) => {
    root.updateMatrixWorld(true);
    let min = Infinity, max = -Infinity;
    root.traverse((o) => {
      if (o.name !== name) return;
      const b = new THREE.Box3().setFromObject(o);
      min = Math.min(min, b.min.y);
      max = Math.max(max, b.max.y);
    });
    return max - min;
  };
  const tileEaveY = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    let min = Infinity;
    root.traverse((o) => {
      if (o.name !== "封闭瓦面") return;
      min = Math.min(min, new THREE.Box3().setFromObject(o).min.y);
    });
    return min;
  };
  resetVillaParams();
  const shallow = new THREE.Group(), deep = new THREE.Group(), tallGap = new THREE.Group();
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    gutterClearDepth: 0.12,
    gutterInnerDepth: 0.22,
    gutterTileGap: 0.02,
    gutterCopingSlope: 0,
  });
  attachRoofs(shallow, new THREE.Group(), mat, 4.5, "joined");
  const h0 = wallSpan(shallow, "天沟外挡边");
  const eave0 = tileEaveY(shallow);
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    gutterClearDepth: 0.4,
    gutterInnerDepth: 0.55,
    gutterTileGap: 0.02,
    gutterCopingSlope: 10,
  });
  attachRoofs(deep, new THREE.Group(), mat, 4.5, "joined");
  const h1 = wallSpan(deep, "天沟外挡边");
  const eave1 = tileEaveY(deep);
  assert.ok(h1 > h0 + 0.2, `外侧加高后外挡应升高：${h0} → ${h1}`);
  assert.ok(eave1 > eave0 + 0.25, `内侧加高后瓦檐应升高：${eave0} → ${eave1}`);
  assert.ok(wallSpan(deep, "天沟内挡边") > wallSpan(deep, "天沟外挡边"), "内侧挡墙应高于外侧");
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    gutterClearDepth: 0.4,
    gutterInnerDepth: 0.55,
    gutterTileGap: 0.2,
    gutterCopingSlope: 10,
  });
  attachRoofs(tallGap, new THREE.Group(), mat, 4.5, "joined");
  assert.ok(tileEaveY(tallGap) > eave1 + 0.15, "加大瓦至内挡顶间距后瓦檐再升高");
  resetVillaParams();
});

test("主辅楼天沟外边反坎高200、净宽600、压顶内倾与瓦边探入", () => {
  const m = mainRoofFootprint(), a = annexRoofFootprint();
  const clear = roofGutterDesign.clearWidth;
  const outerT = roofGutterDesign.outerTopWidth;
  const innerT = roofGutterDesign.innerWallThickness;
  const overhang = roofGutterDesign.tileOverhang;
  const lipInset = outerT + clear + innerT;
  const tileInset = lipInset - overhang;
  const midChannel = outerT + clear / 2;
  assert.ok(overhang > 0, "默认瓦边须探出内沿");
  assert.equal(clear, 0.6);
  assert.equal(outerT, 0.3);
  assert.equal(roofGutterDesign.clearDepth, 0.2);
  assert.equal(roofGutterDesign.innerDepth, 0.25);
  for (const style of ["joined", "floating"] as const) for (const pitch of [1, 4.5, 10]) {
    const roof = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(roof, annex, mat, pitch, style);
    for (const [root, label, sections] of [
      // 官帽前凸段另有专项检查；此处只验主屋四边与辅楼四边的天沟剖面。
      [roof, "主屋", [
        [m.x + 1.5, m.z, 0, 1], [m.x + m.w / 2, m.z + m.d, 0, -1],
        [m.x, m.z + m.d / 2, 1, 0], [m.x + m.w, m.z + m.d / 2, -1, 0],
      ]],
      [annex, "辅楼", [
        [a.x + a.w / 2, a.z, 0, 1], [a.x + a.w / 2, a.z + a.d, 0, -1],
        [a.x, a.z + a.d / 2, 1, 0], [a.x + a.w, a.z + a.d / 2, -1, 0],
      ]],
    ] as const) {
      root.updateMatrixWorld(true);
      const beds: THREE.Object3D[] = [], outerWalls: THREE.Object3D[] = [], copings: THREE.Object3D[] = [], innerWalls: THREE.Object3D[] = [], tiles: THREE.Object3D[] = [];
      root.traverse(object => {
        if (object.name === "天沟槽底") beds.push(object);
        if (object.name === "天沟外挡边") outerWalls.push(object);
        if (object.name === "天沟外边反坎压顶") copings.push(object);
        if (object.name === "天沟内挡边") innerWalls.push(object);
        if (object.name === "封闭瓦面") tiles.push(object);
      });
      for (const [x, z, nx, nz] of sections) {
        const tag = `${style}/${pitch}分水 ${label} @ ${x},${z}`;
        const point = (offset: number, y = 25) => new THREE.Vector3(x + nx * offset, y, z + nz * offset);
        const height = (objects: THREE.Object3D[], offset: number) => {
          const hits = new THREE.Raycaster(point(offset), new THREE.Vector3(0, -1, 0)).intersectObjects(objects, false);
          assert.ok(hits.length, `${tag} 天沟构件应封闭`);
          return hits[0].point.y;
        };
        const bedNearOuter = height(beds, midChannel);
        assert.ok(Number.isFinite(bedNearOuter), `${tag} 槽底应可读`);
        for (const wall of outerWalls) {
          const b = new THREE.Box3().setFromObject(wall);
          // 外挡顶略低于压顶底（约 3mm），避免共面；高度仍接近设计反坎高。
          assert.ok(
            Math.abs((b.max.y - b.min.y) - (roofGutterDesign.clearDepth - 0.003)) < 0.01,
            `${tag} 外边反坎高应接近${roofGutterDesign.clearDepth * 1000}毫米`,
          );
        }
        assert.ok(copings.length > 0, `${tag} 应有外边反坎压顶`);
        const copeOuter = height(copings, -0.01);
        const copeInner = height(copings, outerT * 0.7);
        assert.ok(copeOuter > copeInner, `${tag} 压顶应外高内低`);
        const direction = new THREE.Vector3(nx, 0, nz);
        const outerCrest = height(outerWalls, outerT * 0.5);
        const wallHit = new THREE.Raycaster(
          point(midChannel, outerCrest - roofGutterDesign.clearDepth * 0.5),
          direction.clone().negate(),
        ).intersectObjects(outerWalls, false)[0];
        const tileEave = height(tiles, tileInset + 0.001);
        const tileHit = new THREE.Raycaster(point(-0.05, tileEave), direction).intersectObjects(tiles, false)[0];
        assert.ok(wallHit, `${tag} 应接到外挡`);
        assert.ok(tileHit, `${tag} 应接到瓦边`);
        assert.ok(
          Math.abs(wallHit.distance - (midChannel - outerT)) < 0.03,
          `${tag} 外挡内侧应对准净宽起点`,
        );
        assert.ok(
          Math.abs(tileHit.distance - (0.05 + tileInset)) < 0.03,
          `${tag} 外皮至瓦边应为内挡沟侧再减探入量`,
        );
        assert.ok(tileHit.distance < 0.05 + lipInset - 1e-5, `${tag} 瓦边须超过内沿伸进沟内`);
        const lipTop = height(innerWalls, outerT + clear + innerT / 2);
        assert.ok(
          Math.abs(tileEave - lipTop - roofGutterDesign.tileGap) < 0.02,
          `${tag} 瓦檐应高出内挡顶约${roofGutterDesign.tileGap * 1000}毫米（得 ${((tileEave - lipTop) * 1000).toFixed(1)}）`,
        );
      }
    }
  }
});

test("官帽与正屋在1、4.5、10分水均只有一层外露坡面，交线两侧没有透缝或埋入瓦面", () => {
  const m = mainRoofFootprint(), e = m.eave + roofTileEaveLift(), center = site.portico.x + site.portico.w / 2;
  const x0 = m.x + inset, z0 = m.z + inset, w = m.w - 2 * inset, d = m.d - 2 * inset;
  const left = center - frontElevation.hatWidth / 2 + inset, right = 2 * center - left;
  const front = frontElevation.hatFront + inset, peakFront = frontElevation.hatFront + frontElevation.hatWidth * 0.42;
  for (const pitch of [1, 4.5, 10]) {
    const rise = roofPitch(pitch).mainRise, peak = e + rise;
    const main = hipRoofSurfaces(x0, z0, w, d, e, rise);
    const hat = hatRoofSurfaces(center, frontElevation.hatFront, frontElevation.hatWidth, m.z + m.d / 2, e, peak);
    const group = new THREE.Group();
    addTiledRoof(group, joinRoofFaces([...main.faces, ...hat.faces]), mat.villaRoof, mat.villaRoofJoint);
    for (let x = left + 0.037; x < right - 0.01; x += 0.193) for (let z = front + 0.061; z < m.z + m.d / 2; z += 0.217) {
      const heights = [e + rise * Math.min((x - left) / (center - left), (right - x) / (right - center), (z - front) / (peakFront - front), 1)];
      if (z >= z0) heights.push(e + rise * Math.min((x - x0) / (d / 2), (x0 + w - x) / (d / 2), (z - z0) / (d / 2), (z0 + d - z) / (d / 2), 1));
      const hits = topHits(group, x, z);
      assert.equal(hits.length, 1, `${pitch}分水 @ ${x},${z} 的外露面应唯一`);
      assert.ok(Math.abs(hits[0].point.y - Math.max(...heights)) < 2e-5, "不能用较低的埋入屋面遮住裂口");
    }
  }
});

test("悬浮官帽斜脊平行、纵脊直接接入正屋，帽顶降低且屋面无缝", () => {
  const m = mainRoofFootprint();
  for (const pitch of [1, 4.5, 10]) {
    const roof = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(roof, annex, mat, pitch, "floating");
    const main = roof.getObjectByName("正屋四坡")!;
    const cap = roof.getObjectByName("悬浮官帽接入正屋")!;
    assert.ok(main && cap);
    assert.equal(roof.getObjectByName("中央官帽"), undefined);
    let outerMinZ = Infinity;
    main.traverse((o) => {
      if (o.name === "天沟外挡边") outerMinZ = Math.min(outerMinZ, new THREE.Box3().setFromObject(o).min.z);
    });
    assert.ok(Math.abs(outerMinZ - m.z) < 1e-4, "主屋前檐外挡保留完整直线（压顶可外飘）");
    const h = floatingHatLayout(pitch), center = h.x + h.w / 2;
    const mainRun = (Math.min(m.w, m.d) - 2 * inset) / 2;
    const hatRun = (h.w - 2 * inset) / 2;
    const height = (x: number, z: number, b: typeof m, rise: number, run: number) =>
      b.eave + roofTileEaveLift() + rise * Math.min((x - b.x - inset) / run, (b.x + b.w - inset - x) / run, (z - b.z - inset) / run, (b.z + b.d - inset - z) / run, 1);
    for (let x = h.x + (inset + 0.037); x < h.x + h.w - inset - 0.02; x += 0.193)
      for (let z = m.z + (inset + 0.057); z < h.joinZ - 0.01; z += 0.157) {
        const hatHeight = h.eave + roofTileEaveLift() + h.rise * Math.min((x - h.x - inset) / hatRun, (h.x + h.w - inset - x) / hatRun, (z - h.z - inset) / hatRun, 1);
        const expected = Math.max(height(x, z, m, roofPitch(pitch).mainRise, mainRun), hatHeight);
        const hits = topHits(roof, x, z);
        assert.equal(hits.length, 1, `${pitch}分水交接处应只留一层屋面 @ ${x},${z}`);
        assert.ok(Math.abs(hits[0].point.y - expected) < 2e-5, "后坡不能出现缺口、悬空封边或重叠瓦面");
      }
    // 后端已完全埋入正屋，不再留下独立的横向后檐或后坡断边。
    for (let x = h.x + 0.4; x < h.x + h.w - 0.4; x += 0.271) {
      assert.equal(topHits(cap, x, h.joinZ + 0.017).length, 0);
      assert.equal(topHits(main, x, h.joinZ + 0.017).length, 1);
    }
    const sideJoin = m.z + inset + (h.eave - m.eave) / (pitch / 10);
    const capGeometry = hatRoofSurfaces(center, h.z, h.w, h.joinZ, h.eave + roofTileEaveLift(), h.peak, 1, h.ridgeFront);
    const mainGeometry = hipRoofSurfaces(m.x + inset, m.z + inset, m.w - 2 * inset, m.d - 2 * inset, m.eave + roofTileEaveLift(), roofPitch(pitch).mainRise);
    const ridge = capGeometry.ridges[2];
    assert.ok(Math.abs(ridge.b.y - height(ridge.b.x, ridge.b.z, m, roofPitch(pitch).mainRise, mainRun)) < 1e-8, "帽脊末端必须与正屋坡面同点同高");
    for (const i of [0, 1]) {
      const a = capGeometry.ridges[i].b.clone().sub(capGeometry.ridges[i].a);
      const b = mainGeometry.ridges[i].b.clone().sub(mainGeometry.ridges[i].a);
      assert.ok(Math.abs(a.x * b.z - a.z * b.x) < 1e-8, "两条前斜脊的平面走向须与主屋斜脊平行");
      if (pitch >= 4.5)
        assert.ok(a.clone().normalize().cross(b.normalize()).length() < 1e-8, "常用坡度下斜脊空间方向也平行");
    }
    const drop = m.eave + roofTileEaveLift() + roofPitch(pitch).mainRise - h.peak;
    assert.ok(drop >= 0.05 - 1e-8, "帽顶必须低于主屋顶");
    if (pitch >= 4.5) assert.ok(Math.abs(drop - 0.5) < 1e-8, "常用坡度下帽顶低于主脊50cm");
    for (const x of [h.x + (inset + 0.001), h.x + h.w - (inset + 0.001)]) {
      const heights = [-0.002, 0.002].map(offset => topHits(roof, x, sideJoin + offset));
      assert.ok(heights.every(hits => hits.length === 1), "左右交线两侧都应封闭");
      assert.ok(Math.abs(heights[0][0].point.y - heights[1][0].point.y) < 0.005, "交界高度须连续");
    }
    const eaves = cap.getObjectByName("前檐及两侧融入正屋的天沟")!;
    eaves.updateMatrixWorld(true);
    const mainTileFront = m.z + inset;
    eaves.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute("position"), p = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        // 只检查进入正屋瓦面进深范围的后端；前方悬挑可低于正屋瓦面外推平面。
        if (p.z < mainTileFront - 1e-4) continue;
        const mainHeight = m.eave + roofTileEaveLift() + (p.z - mainTileFront) * pitch / 10;
        assert.ok(p.y >= mainHeight - 2e-5, "檐底、天沟和线脚后端应斜切贴合，不穿进主屋瓦面");
      }
    });
    const fascia = cap.getObjectByName("天沟外挡边")!;
    // 前挡顶宽已改为 0.3 m，探测起点须越过前反坎，只查是否误加后天沟横档。
    for (let z = h.z + roofGutterDesign.outerTopWidth + 0.05; z < h.z + h.d; z += 0.173) {
      const hits = new THREE.Raycaster(new THREE.Vector3(center, 25, z), new THREE.Vector3(0, -1, 0)).intersectObject(fascia);
      assert.equal(hits.length, 0, "不能恢复跨过屋面的官帽后天沟");
    }
    const underside = new THREE.Box3().setFromObject(roof.getObjectByName("悬浮官帽封闭檐底")!).min.y;
    if (pitch === 4.5) {
      const expected = apronFasciaBottom(h.eave, 0);
      assert.ok(Math.abs(underside - expected) < 0.06, "封闭檐底贴在三眼皮下沿");
      assert.ok(eyelidStackHeight() === 0.35, "三眼皮总高固定 350mm");
      assert.ok(h.eave - m.eave > 0.05, "帽檐相对正屋檐口仍留柱头净空");
    }
    assert.ok(eaves.getObjectByName("檐下梁托与下沿线"), "悬浮官帽前／侧檐应有梁托与下沿线");
    assert.equal(roof.getObjectByName("悬浮官帽横梁与柱头"), undefined, "柱身装饰改由三楼加高柱承担，不再叠英国风斜杠板");
  }
});

test("悬浮官帽柱比原有官帽更高，正面装饰造型共用", async () => {
  const { buildVilla } = await import("../src/architecture");
  const { fasciaBottomY } = await import("../src/roof-options");
  const joined = buildVilla(mat, false, 4.5, "joined");
  const floating = buildVilla(mat, false, 4.5, "floating");
  const joinedPier = joined.levels[2].getObjectByName("官帽柱")!;
  const floatingPier = floating.levels[2].getObjectByName("官帽柱")!;
  const joinedBox = new THREE.Box3().setFromObject(joinedPier);
  const floatingBox = new THREE.Box3().setFromObject(floatingPier);
  assert.ok(floatingBox.max.y > joinedBox.max.y + 0.2, "悬浮官帽柱应明显高于原有官帽柱");
  assert.ok(joinedPier.getObjectByName("官帽柱正面装饰"), "原有官帽柱有正面装饰");
  assert.ok(floatingPier.getObjectByName("官帽柱正面装饰"), "悬浮官帽柱共用同一正面装饰");
  const h = floatingHatLayout(4.5);
  assert.ok(Math.abs(floatingBox.max.y - (h.eave - 0.13)) < 0.08, "悬浮柱顶贴悬浮檐口");
  const decorTop = fasciaBottomY(h.eave, 0) - 0.1;
  const decor = floatingPier.getObjectByName("官帽柱正面装饰")!;
  const decorBox = new THREE.Box3().setFromObject(decor);
  assert.ok(Math.abs(decorBox.max.y - decorTop) < 0.08, "装饰上沿在悬浮下沿线底以下约 10 cm");
});

test("露台折线瓦檐的内外转角单层相接，柱脚处留精确切口", () => {
  const e = frontElevation, west = e.sideTerraces[0].x, east = e.sideTerraces[1].x + e.sideTerraces[1].w;
  const cw = site.portico.x, ce = cw + site.portico.w, v = site.secondFrontEave;
  const inner: Point[] = [[west,e.terraceBack],[west,e.terraceFront],[cw,e.terraceFront],[cw,e.centerFront],[ce,e.centerFront],[ce,e.terraceFront],[east,e.terraceFront],[east,e.terraceBack]];
  const outer: Point[] = [[west-v,e.terraceBack],[west-v,e.terraceFront-v],[cw-v,e.terraceFront-v],[cw-v,e.centerFront-v],[ce+v,e.centerFront-v],[ce+v,e.terraceFront-v],[east+v,e.terraceFront-v],[east+v,e.terraceBack]];
  const holes: Point[][] = e.balustradePosts.map(p => [[p.x-.34,p.z-.34],[p.x+.34,p.z-.34],[p.x+.34,p.z+.34],[p.x-.34,p.z+.34]]);
  const ribbon = [...outer, ...inner.slice().reverse()], group = new THREE.Group();
  tiledApron(group, inner, outer, 7.7, e.tiledEaveDrop, mat, holes);
  // 瓦面缩进至天沟内沿探入处；只在瓦覆盖带内要求单层命中，柱脚切口仍须留空。
  const tileRibbon = (() => {
    let projection = Infinity;
    for (let i = 0; i < outer.length; i++) {
      const dx = Math.abs(outer[i][0] - inner[i][0]);
      const dz = Math.abs(outer[i][1] - inner[i][1]);
      if (dx > 0.01 && dz <= 0.01) projection = Math.min(projection, dx);
      if (dz > 0.01 && dx <= 0.01) projection = Math.min(projection, dz);
    }
    const span = Number.isFinite(projection) ? projection : 0.7;
    const t = Math.min(1, inset / Math.max(span, 1e-6));
    const rim = outer.map((p, i) => {
      const q = inner[i];
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] as Point;
    });
    return [...rim, ...inner.slice().reverse()];
  })();
  for (let x = west - v + 0.031; x < east + v; x += 0.157) for (let z = e.centerFront - v + 0.047; z < e.terraceBack; z += 0.137) {
    const inOld = contains([x, z], ribbon) && !holes.some(h => contains([x, z], h));
    if (!inOld) {
      assert.equal(topHits(group, x, z).length, 0, `柱脚／域外不应有瓦 @ ${x},${z}`);
      continue;
    }
    const expectTile = contains([x, z], tileRibbon) && !holes.some(h => contains([x, z], h));
    if (expectTile) assert.equal(topHits(group, x, z).length, 1, `瓦檐重复、漏缝或穿柱 @ ${x},${z}`);
  }
});

test("陡坡、缓坡的筒瓦整个圆截面都收在本坡范围内，不穿过官帽交线", () => {
  const m = mainRoofFootprint(), center = site.portico.x + site.portico.w / 2;
  for (const pitch of [1,10]) {
    const eave = m.eave + roofTileEaveLift(), rise = roofPitch(pitch).mainRise;
    const main = hipRoofSurfaces(m.x+inset,m.z+inset,m.w-2*inset,m.d-2*inset,eave,rise);
    const hat = hatRoofSurfaces(center,frontElevation.hatFront,frontElevation.hatWidth,m.z+m.d/2,eave,eave+rise);
    const joined = joinRoofFaces([...main.faces,...hat.faces]);
    for (const owner of [0,1]) {
      const faces = joined.filter(face => face.owner === owner), group = new THREE.Group();
      const footprints: Point[][] = faces.map(face => face.points.map(p => [p.x,p.z]));
      addTiledRoof(group, faces, mat.villaRoof, mat.villaRoofJoint);
      const ribs = group.getObjectByName("分片筒瓦") as THREE.InstancedMesh;
      const positions = ribs.geometry.getAttribute("position"), matrix = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let i=0; i<ribs.count; i++) {
        ribs.getMatrixAt(i,matrix);
        for (let k=0; k<positions.count; k++) {
          v.fromBufferAttribute(positions,k).applyMatrix4(matrix);
          assert.ok(footprints.some(polygon => contains([v.x,v.z],polygon)), `${pitch}分水的筒瓦伸出本坡 @ ${v.x},${v.z}`);
        }
      }
    }
  }
});

// 从实际筒瓦实例反查覆盖，独立于渲染器的分组键与裁切间隔计算。
// 距真实屋面边界9cm以上的瓦垄，不得因同坡面被分片而中途消失。
test("两种官帽裁切后同坡瓦垄连续，人工分片线两侧没有漏铺或重复筒瓦", () => {
  const m = mainRoofFootprint(), center = site.portico.x + site.portico.w / 2;
  for (const style of ["joined", "floating"] as const) for (const pitch of [1, 4.5, 10]) {
    const eave = m.eave + roofTileEaveLift(), rise = roofPitch(pitch).mainRise;
    const main = hipRoofSurfaces(m.x + inset, m.z + inset, m.w - 2 * inset, m.d - 2 * inset, eave, rise);
    const h = floatingHatLayout(pitch);
    const hat = style === "joined"
      ? hatRoofSurfaces(center, frontElevation.hatFront, frontElevation.hatWidth, m.z + m.d / 2, eave, eave + rise)
      : hatRoofSurfaces(center, h.z, h.w, h.joinZ, h.eave + roofTileEaveLift(), h.peak, 1, h.ridgeFront);
    const original = [...main.faces, ...hat.faces], visible = joinRoofFaces(original);
    for (const owner of [0, 1]) {
      const group = new THREE.Group(), faces = visible.filter(face => face.owner === owner);
      addTiledRoof(group, faces, mat.villaRoof, mat.villaRoofJoint);
      const ribs = group.getObjectByName("分片筒瓦") as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      const segments = Array.from({ length: ribs.count }, (_, i) => {
        ribs.getMatrixAt(i, matrix);
        return [-0.5, 0.5].map(y => new THREE.Vector3(0, y, 0).applyMatrix4(matrix));
      });
      for (const source of original.filter(face => face.owner === owner)) {
        const normal = source.points[1].clone().sub(source.points[0]).cross(source.points[2].clone().sub(source.points[0])).normalize();
        if (normal.y < 0) normal.negate();
        const samePlane = faces.filter(face => face.points.every(p => Math.abs(p.clone().sub(source.points[0]).dot(normal)) < 1e-7));
        if (!samePlane.length) continue;
        const polygons: Point[][] = samePlane.map(face => face.points.map(p => [p.x, p.z]));
        const across = source.across, down: Point = [-across[1], across[0]];
        const project = (x: number, z: number, axis: Point) => x * axis[0] + z * axis[1];
        const originU = project(...source.origin, across), originV = project(...source.origin, down);
        const us = polygons.flat().map(p => project(...p, across)), vs = polygons.flat().map(p => project(...p, down));
        const runs = new Map<number, [number, number][]>();
        for (const ends of segments) {
          const points = ends.map(p => p.clone().addScaledVector(normal, -0.022));
          if (!points.every(p => Math.abs(p.clone().sub(source.points[0]).dot(normal)) < 1e-5)) continue;
          const k = Math.round((project(points[0].x, points[0].z, across) - originU) / 0.18);
          const span = points.map(p => project(p.x, p.z, down)).sort((a, b) => a - b) as [number, number];
          if (!runs.has(k)) runs.set(k, []);
          runs.get(k)!.push(span);
        }
        for (let k = Math.ceil((Math.min(...us) - originU) / 0.18); k <= Math.floor((Math.max(...us) - originU) / 0.18); k++) {
          const u = originU + k * 0.18;
          for (let v = Math.min(...vs) + 0.097; v < Math.max(...vs); v += 0.137) {
            const x = across[0] * u + down[0] * v, z = across[1] * u + down[1] * v;
            const interior = Array.from({ length: 16 }, (_, i) => {
              const angle = i * Math.PI / 8;
              return polygons.some(polygon => contains([x + 0.09 * Math.cos(angle), z + 0.09 * Math.sin(angle)], polygon));
            }).every(Boolean);
            if (!interior || Math.abs((v - originV) / 0.26 - Math.round((v - originV) / 0.26)) < 0.02) continue;
            const covering = (runs.get(k) ?? []).filter(([lo, hi]) => v >= lo - 1e-5 && v <= hi + 1e-5);
            assert.equal(covering.length, 1, `${style}/${pitch}分水 owner${owner} 的完整坡面漏铺或重复 @ ${x.toFixed(3)},${z.toFixed(3)}`);
          }
        }
      }
    }
  }
});

test("天沟槽底找坡只抬厘米级，不会把本地顶面写成屋面世界标高", () => {
  const group = new THREE.Group();
  gutteredRoof(group, 0, 0, 8, 10, 10.5, 1.2, mat);
  group.updateMatrixWorld(true);
  const beds: THREE.Object3D[] = [];
  group.traverse((o) => { if (o.name === "天沟槽底") beds.push(o); });
  assert.ok(beds.length > 0);
  for (const bed of beds) {
    const local = new THREE.Box3().setFromObject(bed);
    // 世界高度应在屋面附近，厚度／找坡合计远小于 1 m，绝不能出现整层楼高的灰盒子。
    assert.ok(local.max.y - local.min.y < 0.25, `槽底竖直包络过大：${(local.max.y - local.min.y).toFixed(3)}`);
    assert.ok(local.max.y < 11.2 && local.min.y > 10.2, `槽底世界高度异常：${local.min.y.toFixed(2)}–${local.max.y.toFixed(2)}`);
  }
});

test("梁托中心按面宽／拐角间距排布，两端内收半个拐角距", () => {
  const centers = corbelCentersOnEdge(13.5);
  assert.ok(centers.length >= 2);
  assert.ok(Math.abs(centers[0] - eaveTrimDesign.corbelCornerSpacing / 2) < 1e-9);
  assert.ok(Math.abs(centers.at(-1)! - (13.5 - eaveTrimDesign.corbelCornerSpacing / 2)) < 1e-9);
  if (centers.length > 2) {
    const step = centers[1] - centers[0];
    assert.ok(Math.abs(step - eaveTrimDesign.corbelSpacing) < 0.15, "中距应接近默认 700mm");
  }
});

test("梁托背面贴三楼墙皮；主辅楼统一500×200×160，不随出檐缩短", async () => {
  const { attachRoofs, mainRoofFootprint } = await import("../src/architecture");
  const { site, floors } = await import("../src/data");
  const roof = new THREE.Group(), annex = new THREE.Group();
  attachRoofs(roof, annex, mat, 4.5, "joined");
  roof.updateMatrixWorld(true);
  const wall = {
    x0: site.main.x,
    x1: site.main.x + site.main.w,
    z0: floors[2].front,
    z1: site.main.z + site.main.d,
  };
  const rf = mainRoofFootprint();
  const overhangs = {
    east: rf.x + rf.w - wall.x1,
    west: wall.x0 - rf.x,
    north: wall.z0 - rf.z,
    south: rf.z + rf.d - wall.z1,
  };
  // 主楼四面统一 thirdEave；梁托成品尺寸固定 500×200×160。
  for (const [face, o] of Object.entries(overhangs)) {
    assert.ok(Math.abs(o - site.thirdEave) < 0.01, `${face} 出檐应为 ${site.thirdEave}`);
  }
  const expect = eaveTrimDesign.corbelLength;
  const corbels: THREE.Object3D[] = [];
  roof.traverse((o) => { if (o.name === "梁托") corbels.push(o); });
  assert.ok(corbels.length > 10, "主楼四周应有梁托");
  const { frontElevation } = await import("../src/data");
  const under = roofGutterDesign.outerTopWidth + roofGutterDesign.clearWidth * 0.35;
  const hatWest = site.portico.x + site.portico.w / 2 - frontElevation.hatWidth / 2 + under;
  const hatEast = site.portico.x + site.portico.w / 2 + frontElevation.hatWidth / 2 - under;
  const hatFrontFace = frontElevation.hatFront + under;
  // 官帽前／侧梁托挂在檐下内侧，不要求贴退台墙皮；其余仍须贴墙。
  for (const c of corbels) {
    const b = new THREE.Box3().setFromObject(c);
    const nearWall = Math.min(
      Math.abs(b.min.x - wall.x0), Math.abs(b.max.x - wall.x0),
      Math.abs(b.min.x - wall.x1), Math.abs(b.max.x - wall.x1),
      Math.abs(b.min.z - wall.z0), Math.abs(b.max.z - wall.z0),
      Math.abs(b.min.z - wall.z1), Math.abs(b.max.z - wall.z1),
    );
    const nearHatFace = Math.min(
      Math.abs(b.min.z - hatFrontFace), Math.abs(b.max.z - hatFrontFace),
      Math.abs(b.min.x - hatWest), Math.abs(b.max.x - hatWest),
      Math.abs(b.min.x - hatEast), Math.abs(b.max.x - hatEast),
    );
    assert.ok(nearWall < 0.02 || nearHatFace < 0.05, `梁托背面离墙 ${nearWall.toFixed(3)} m、离官帽檐 ${nearHatFace.toFixed(3)} m`);
    const spanX = b.max.x - b.min.x, spanZ = b.max.z - b.min.z, spanY = b.max.y - b.min.y;
    const out = Math.max(spanX, spanZ);
    const along = Math.min(spanX, spanZ);
    assert.ok(Math.abs(out - expect) < 1e-6, `出挑应为 ${expect.toFixed(2)}，得 ${out.toFixed(3)}`);
    assert.ok(Math.abs(along - eaveTrimDesign.corbelWidth) < 1e-6, `厚度应为160mm，得 ${along.toFixed(3)}`);
    assert.ok(Math.abs(spanY - 0.2) < 1e-6, `高度应为200mm，得 ${spanY.toFixed(3)}`);
  }
  annex.updateMatrixWorld(true);
  let annexCorbelCount = 0;
  annex.traverse((o) => {
    if (o.name !== "梁托") return;
    annexCorbelCount++;
    const span = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    assert.ok(Math.abs(Math.max(span.x, span.z) - 0.5) < 1e-6, "辅楼梁托同样长500mm，不随较短出檐缩小");
    assert.ok(Math.abs(Math.min(span.x, span.z) - 0.16) < 1e-6, "辅楼梁托宽160mm");
    assert.ok(Math.abs(span.y - 0.2) < 1e-6, "辅楼梁托高200mm");
  });
  assert.ok(annexCorbelCount > 10, "辅楼四周应有梁托");
  // 辅楼三眼皮：最上层＝出挑、最下层＝出挑−0.2，与主楼同一台阶。
  const annexWall = { x: site.annex.x, z: site.annex.z, w: site.annex.w, d: site.annex.d };
  const lids = annex.getObjectByName("三眼皮檐口");
  assert.ok(lids, "辅楼应有三眼皮");
  const layerOverhangs: number[] = [];
  lids!.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const b = new THREE.Box3().setFromObject(o);
    layerOverhangs.push(annexWall.z - b.min.z);
  });
  layerOverhangs.sort((a, b) => b - a);
  assert.equal(layerOverhangs.length, 3);
  assert.ok(Math.abs(layerOverhangs[0] - site.thirdEave) < 0.01, `最上层出挑 ${layerOverhangs[0]}`);
  assert.ok(Math.abs(layerOverhangs[1] - (site.thirdEave - 0.1)) < 0.01, `中层出挑 ${layerOverhangs[1]}`);
  assert.ok(Math.abs(layerOverhangs[2] - (site.thirdEave - 0.2)) < 0.01, `最下层出挑 ${layerOverhangs[2]}`);
  assert.ok(layerOverhangs[2] - eaveTrimDesign.corbelLength > 0.09, "梁托端头应比最下层短约100mm");
});

test("梁托侧视包络为落款 500×200，沿墙挤出 160", async () => {
  const { corbelProfileShape } = await import("../src/facade-details");
  const L = eaveTrimDesign.corbelLength;
  const H = eaveTrimDesign.corbelHeight;
  const W = eaveTrimDesign.corbelWidth;
  assert.equal(L, 0.5);
  assert.equal(H, 0.2);
  assert.equal(W, 0.16);
  const shape = corbelProfileShape(L, H);
  const pts = shape.getPoints(64);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  assert.ok(Math.min(...xs) > -1e-6 && Math.max(...xs) < L + 1e-6, "出挑落在 0–500");
  assert.ok(Math.min(...ys) > -1e-6 && Math.max(...ys) < H + 1e-6, "高度落在 0–200");
  assert.ok(Math.abs(Math.max(...xs) - L) < 1e-6, "端头顶到设计长度");
  assert.ok(Math.abs(Math.max(...ys) - H) < 1e-6, "顶面到设计高度");
  // 端头应明显薄于贴墙：端头附近 y 下限明显高于 0
  const tipYs = pts.filter((p) => p.x > L * 0.92).map((p) => p.y);
  assert.ok(Math.min(...tipYs) > H * 0.7, "端头为小方唇，不是贴墙全高");
  // 中段 underside 应明显高于底脚，形成 S 形收进（不是三角楔）
  const midYs = pts.filter((p) => p.x > L * 0.25 && p.x < L * 0.55).map((p) => p.y);
  assert.ok(Math.min(...midYs) > H * 0.15, "中段 underside 应抬离底脚");
  // 原图独立采样：约束竖脚、靠墙小弧、S 弧腰部与端头台阶，不能仅包络相同。
  const outline = shape.getPoints(256);
  const undersideAt = (x: number) => {
    const hits: number[] = [];
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1], b = outline[i];
      if (Math.abs(a.x - b.x) < 1e-9 || x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
      hits.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
    }
    return Math.min(...hits);
  };
  const reference: [number, number][] = [
    [60, 164], [84, 164], [90, 133.5], [105, 138.5], [130, 128],
    [140, 111.5], [170, 120], [200, 114], [220, 100], [240, 73],
    [260, 55.5], [290, 43], [310, 42.5], [330, 51], [360, 43],
  ];
  for (const [px, py] of reference) {
    const x = (px - 39) / 335 * L;
    const expected = (164 - py) / 148 * H;
    assert.ok(Math.abs(undersideAt(x) - expected) < 0.004, `图中x=${px}处应贴合原图轮廓（4mm内）`);
  }
});

test("下沿线在墙角外方咬合，拐角不断开", async () => {
  const { attachRoofs } = await import("../src/architecture");
  const { site, floors } = await import("../src/data");
  const { eyelidFixed } = await import("../src/roof-options");
  const roof = new THREE.Group();
  attachRoofs(roof, new THREE.Group(), mat, 4.5, "joined");
  roof.updateMatrixWorld(true);
  const trim = roof.getObjectByName("檐下梁托与下沿线");
  assert.ok(trim, "应有下沿线组");
  const p = eyelidFixed.fasciaProtrusion;
  // 东北外角：X 最大边与 Z 最小边应交处应被下沿线占据。
  const cornerX = site.main.x + site.main.w + p / 2;
  const cornerZ = floors[2].front - p / 2;
  const ray = new THREE.Raycaster(
    new THREE.Vector3(cornerX, 12, cornerZ),
    new THREE.Vector3(0, -1, 0),
  );
  const hits = ray.intersectObject(trim!, true);
  assert.ok(hits.length > 0, "东北拐角应有下沿线实体");
});

test("三楼洞口上沿低于下沿线板底", async () => {
  const { facades, thirdFloorMaxOpeningHead } = await import("../src/facades");
  const { floors } = await import("../src/data");
  const { fasciaBottomY, openingBelowFasciaClearance } = await import("../src/roof-options");
  const maxHead = thirdFloorMaxOpeningHead();
  const fasciaBot = fasciaBottomY(10.5, 0);
  assert.ok(Math.abs(maxHead - (fasciaBot - openingBelowFasciaClearance - floors[2].y)) < 1e-9);
  for (const wall of facades(2)) {
    for (const o of wall.openings) {
      assert.ok(
        o.sill + o.h <= maxHead + 1e-9,
        `洞口顶 ${ (o.sill + o.h).toFixed(3) } 不得超过 ${maxHead.toFixed(3)}`,
      );
    }
  }
});

test("三眼皮上下连续封闭，线脚背面接到墙体范围", () => {
  const wall = { x: 0.8, z: 0.8, w: 4.4, d: 8.4 };
  const group = new THREE.Group();
  gutteredRoof(group, 0, 0, 6, 10, 3.6, 1.1, mat, undefined, wall);
  const eyelid = group.getObjectByName("三眼皮檐口")!;
  group.updateMatrixWorld(true);
  // 三眼皮自板顶 3.6 往下共 0.35 m；在上下层之间水平探入应封闭。
  for (let y = 3.58; y > 3.28; y -= 0.04) {
    const ray = new THREE.Raycaster(new THREE.Vector3(3.13, y, -1), new THREE.Vector3(0, 0, 1));
    const hits = ray.intersectObject(eyelid, true);
    assert.ok(hits.length > 0 && hits[0].point.z < 0.25, `檐口在 y=${y.toFixed(2)} 透空`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(3.13, 4, wall.z - 0.04), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(eyelid, true).length > 0, "檐板背部要盖到墙边，不留悬空带");
});

test("非整数模数的回纹仍左右等距，所有装饰顶点关于中线对称", () => {
  for (const width of [0.56, 2.1, 3.46, 3.6]) {
    const group = new THREE.Group();
    meander(group, -width / 2, 0, 0, width, mat);
    group.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const p = object.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld));
    });
    const key = (x: number, y: number, z: number) => [x,y,z].map(n => Math.round(n * 1e5)).join(":");
    const coordinates = new Set(points.map(p => key(p.x,p.y,p.z)));
    for (const p of points) assert.ok(coordinates.has(key(-p.x,p.y,p.z)), `${width}米回纹在${p.x}处不对称`);
  }
});

test("窗玻璃与四边框槽相接，框内边缘不再透空", () => {
  const group = new THREE.Group();
  wallWithOpenings(group, [0,0], [4,0], 0, 3, [{at:2,w:2,sill:.5,h:2}], mat);
  group.updateMatrixWorld(true);
  for (const [x,y] of [[1.035,1.2],[2.965,1.2],[1.4,.535],[1.4,2.465]]) {
    const hits = new THREE.Raycaster(new THREE.Vector3(x,y,-1), new THREE.Vector3(0,0,1)).intersectObject(group, true);
    assert.ok(hits.some(hit => (hit.object as THREE.Mesh).material === mat.glass), `窗框内沿漏空 @ ${x},${y}`);
  }
});
