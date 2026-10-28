import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { contains, floors, frontElevation, site, type Point } from "../src/data";
import { attachRoofs, floatingHatLayout, joinedHatLayout, mainRoofFootprint, annexRoofFootprint, roofPitch } from "../src/architecture";
import { corbelCentersOnEdge, gutteredRoof, hatSupportInset, meander, tiledApron } from "../src/facade-details";
import { addTiledRoof, hatRoofSurfaces, hipRoofSurfaces, joinRoofFaces } from "../src/roof-surfaces";
import type { Mats } from "../src/primitives";
import {
  apronFasciaBottom,
  frontApronSection,
  eaveTrimDesign,
  eyelidStackHeight,
  roofGutterDesign,
  roofTileEaveLift,
  roofTileInset as inset,
} from "../src/roof-options";
import { wallWithOpenings } from "../src/primitives";
import { referencePorticoBeam, referencePorticoColumn } from "../src/entrance-carvings";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});

function topHits(root: THREE.Object3D, x: number, z: number) {
  root.updateMatrixWorld(true);
  const surfaces: THREE.Object3D[] = [];
  root.traverse(object => { if (object.name === "封闭瓦面") surfaces.push(object); });
  const hits = new THREE.Raycaster(new THREE.Vector3(x, 25000, z), new THREE.Vector3(0, -1, 0))
    .intersectObjects(surfaces, false).filter(hit => (hit.face?.normal.y ?? 0) > 0.01);
  // 射线恰中公共棱线时相邻坡面各返回一次命中；只有同一点的相交坡面合并。
  // 不同高度，或不同实体的共面重叠仍保留，继续检测叠瓦和重复面。
  return hits.filter((hit, i) => !hits.slice(0, i).some(other =>
    hit.point.distanceTo(other.point) < 1e-4 &&
    (hit.object === other.object || hit.face!.normal.dot(other.face!.normal) < 1 - 1e-8)));
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
    gutterClearDepth: 120,
    gutterInnerDepth: 220,
    gutterTileGap: 20,
    gutterCopingSlope: 0,
  });
  attachRoofs(shallow, new THREE.Group(), mat, 4.5, "joined");
  const h0 = wallSpan(shallow, "天沟外挡边");
  const eave0 = tileEaveY(shallow);
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    gutterClearDepth: 400,
    gutterInnerDepth: 550,
    gutterTileGap: 20,
    gutterCopingSlope: 10,
  });
  attachRoofs(deep, new THREE.Group(), mat, 4.5, "joined");
  const h1 = wallSpan(deep, "天沟外挡边");
  const eave1 = tileEaveY(deep);
  assert.ok(h1 > h0 + 200, `外侧加高后外挡应升高：${h0} → ${h1}`);
  assert.ok(eave1 > eave0 + 250, `内侧加高后瓦檐应升高：${eave0} → ${eave1}`);
  assert.ok(wallSpan(deep, "天沟内挡边") > wallSpan(deep, "天沟外挡边"), "内侧挡墙应高于外侧");
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    gutterClearDepth: 400,
    gutterInnerDepth: 550,
    gutterTileGap: 200,
    gutterCopingSlope: 10,
  });
  attachRoofs(tallGap, new THREE.Group(), mat, 4.5, "joined");
  assert.ok(tileEaveY(tallGap) > eave1 + 150, "加大瓦至内挡顶间距后瓦檐再升高");
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
  assert.equal(clear, 600);
  assert.equal(outerT, 300);
  assert.equal(roofGutterDesign.clearDepth, 200);
  assert.equal(roofGutterDesign.innerDepth, 250);
  for (const style of ["joined", "floating"] as const) for (const pitch of [1, 4.5, 10]) {
    const roof = new THREE.Group(), annex = new THREE.Group();
    attachRoofs(roof, annex, mat, pitch, style);
    for (const [root, label, sections] of [
      // 官帽前凸段另有专项检查；此处只验主屋四边与辅楼四边的天沟剖面。
      [roof, "主屋", [
        [m.x + 1500, m.z, 0, 1], [m.x + m.w / 2, m.z + m.d, 0, -1],
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
        const point = (offset: number, y = 25000) => new THREE.Vector3(x + nx * offset, y, z + nz * offset);
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
            Math.abs((b.max.y - b.min.y) - (roofGutterDesign.clearDepth - 3)) < 10,
            `${tag} 外边反坎高应接近${roofGutterDesign.clearDepth}毫米`,
          );
        }
        assert.ok(copings.length > 0, `${tag} 应有外边反坎压顶`);
        const copeOuter = height(copings, -10);
        const copeInner = height(copings, outerT * 0.7);
        assert.ok(copeOuter > copeInner, `${tag} 压顶应外高内低`);
        const direction = new THREE.Vector3(nx, 0, nz);
        const outerCrest = height(outerWalls, outerT * 0.5);
        const wallHit = new THREE.Raycaster(
          point(midChannel, outerCrest - roofGutterDesign.clearDepth * 0.5),
          direction.clone().negate(),
        ).intersectObjects(outerWalls, false)[0];
        const tileEave = height(tiles, tileInset + 1);
        const tileHit = new THREE.Raycaster(point(-50, tileEave), direction).intersectObjects(tiles, false)[0];
        assert.ok(wallHit, `${tag} 应接到外挡`);
        assert.ok(tileHit, `${tag} 应接到瓦边`);
        assert.ok(
          Math.abs(wallHit.distance - (midChannel - outerT)) < 30,
          `${tag} 外挡内侧应对准净宽起点`,
        );
        assert.ok(
          Math.abs(tileHit.distance - (50 + tileInset)) < 30,
          `${tag} 外皮至瓦边应为内挡沟侧再减探入量`,
        );
        assert.ok(tileHit.distance < 50 + lipInset - 0.01, `${tag} 瓦边须超过内沿伸进沟内`);
        const lipTop = height(innerWalls, outerT + clear + innerT / 2);
        assert.ok(
          Math.abs(tileEave - lipTop - roofGutterDesign.tileGap) < 20,
          `${tag} 瓦檐应高出内挡顶约${roofGutterDesign.tileGap}毫米（得 ${(tileEave - lipTop).toFixed(1)}）`,
        );
      }
    }
  }
});

test("官帽与正屋在1、4.5、10分水均只有一层外露坡面，交线两侧没有透缝或埋入瓦面", () => {
  const m = mainRoofFootprint(), e = m.eave + roofTileEaveLift(), center = site.portico.x + site.portico.w / 2;
  const x0 = m.x + inset, z0 = m.z + inset, w = m.w - 2 * inset, d = m.d - 2 * inset;
  const h = joinedHatLayout();
  const left = h.x + inset, right = h.x + h.w - inset;
  const front = h.z + inset, peakFront = h.ridgeFront;
  for (const pitch of [1, 4.5, 10]) {
    const rise = roofPitch(pitch).mainRise, peak = e + rise;
    const main = hipRoofSurfaces(x0, z0, w, d, e, rise);
    const hat = hatRoofSurfaces(center, h.z, h.w, h.joinZ, e, peak, 1, h.ridgeFront);
    const group = new THREE.Group();
    addTiledRoof(group, joinRoofFaces([...main.faces, ...hat.faces]), mat.villaRoof, mat.villaRoofJoint);
    for (let x = left + 37; x < right - 10; x += 193) for (let z = front + 61; z < m.z + m.d / 2; z += 217) {
      const heights = [e + rise * Math.min((x - left) / (center - left), (right - x) / (right - center), (z - front) / (peakFront - front), 1)];
      if (z >= z0) heights.push(e + rise * Math.min((x - x0) / (d / 2), (x0 + w - x) / (d / 2), (z - z0) / (d / 2), (z0 + d - z) / (d / 2), 1));
      const hits = topHits(group, x, z);
      assert.equal(hits.length, 1, `${pitch}分水 @ ${x},${z} 的外露面应唯一`);
      assert.ok(Math.abs(hits[0].point.y - Math.max(...heights)) < 0.02, "不能用较低的埋入屋面遮住裂口");
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
    assert.ok(Math.abs(outerMinZ - m.z) < 0.1, "主屋前檐外挡保留完整直线（压顶可外飘）");
    const h = floatingHatLayout(pitch), center = h.x + h.w / 2;
    const mainRun = (Math.min(m.w, m.d) - 2 * inset) / 2;
    const hatRun = (h.w - 2 * inset) / 2;
    const height = (x: number, z: number, b: typeof m, rise: number, run: number) =>
      b.eave + roofTileEaveLift() + rise * Math.min((x - b.x - inset) / run, (b.x + b.w - inset - x) / run, (z - b.z - inset) / run, (b.z + b.d - inset - z) / run, 1);
    for (let x = h.x + (inset + 37); x < h.x + h.w - inset - 20; x += 193)
      for (let z = m.z + (inset + 57); z < h.joinZ - 10; z += 157) {
        const hatHeight = h.eave + roofTileEaveLift() + h.rise * Math.min((x - h.x - inset) / hatRun, (h.x + h.w - inset - x) / hatRun, (z - h.z - inset) / hatRun, 1);
        const expected = Math.max(height(x, z, m, roofPitch(pitch).mainRise, mainRun), hatHeight);
        const hits = topHits(roof, x, z);
        assert.equal(hits.length, 1, `${pitch}分水交接处应只留一层屋面 @ ${x},${z}`);
        assert.ok(Math.abs(hits[0].point.y - expected) < 0.02, "后坡不能出现缺口、悬空封边或重叠瓦面");
      }
    // 后端已完全埋入正屋，不再留下独立的横向后檐或后坡断边。
    for (let x = h.x + 400; x < h.x + h.w - 400; x += 271) {
      assert.equal(topHits(cap, x, h.joinZ + 17).length, 0);
      assert.equal(topHits(main, x, h.joinZ + 17).length, 1);
    }
    const sideJoin = m.z + inset + (h.eave - m.eave) / (pitch / 10);
    const capGeometry = hatRoofSurfaces(center, h.z, h.w, h.joinZ, h.eave + roofTileEaveLift(), h.peak, 1, h.ridgeFront);
    const mainGeometry = hipRoofSurfaces(m.x + inset, m.z + inset, m.w - 2 * inset, m.d - 2 * inset, m.eave + roofTileEaveLift(), roofPitch(pitch).mainRise);
    const ridge = capGeometry.ridges[2];
    assert.ok(Math.abs(ridge.b.y - height(ridge.b.x, ridge.b.z, m, roofPitch(pitch).mainRise, mainRun)) < 1e-5, "帽脊末端必须与正屋坡面同点同高");
    for (const i of [0, 1]) {
      const a = capGeometry.ridges[i].b.clone().sub(capGeometry.ridges[i].a);
      const b = mainGeometry.ridges[i].b.clone().sub(mainGeometry.ridges[i].a);
      assert.ok(Math.abs(a.x * b.z - a.z * b.x) < 1e-5, "两条前斜脊的平面走向须与主屋斜脊平行");
      if (pitch >= 4.5)
        assert.ok(a.clone().normalize().cross(b.normalize()).length() < 1e-8, "常用坡度下斜脊空间方向也平行");
    }
    const drop = m.eave + roofTileEaveLift() + roofPitch(pitch).mainRise - h.peak;
    assert.ok(drop >= 50 - 1e-5, "帽顶必须低于主屋顶");
    if (pitch >= 4.5) assert.ok(Math.abs(drop - 500) < 1e-5, "常用坡度下帽顶低于主脊50cm");
    for (const x of [h.x + (inset + 1), h.x + h.w - (inset + 1)]) {
      const heights = [-2, 2].map(offset => topHits(roof, x, sideJoin + offset));
      assert.ok(heights.every(hits => hits.length === 1), "左右交线两侧都应封闭");
      assert.ok(Math.abs(heights[0][0].point.y - heights[1][0].point.y) < 5, "交界高度须连续");
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
        if (p.z < mainTileFront - 0.1) continue;
        const mainHeight = m.eave + roofTileEaveLift() + (p.z - mainTileFront) * pitch / 10;
        assert.ok(p.y >= mainHeight - 0.02, "檐底、天沟和线脚后端应斜切贴合，不穿进主屋瓦面");
      }
    });
    const fascia = cap.getObjectByName("天沟外挡边")!;
    // 前挡顶宽 300，探测起点须越过前反坎，只查是否误加后天沟横档。
    for (let z = h.z + roofGutterDesign.outerTopWidth + 50; z < h.z + h.d; z += 173) {
      const hits = new THREE.Raycaster(new THREE.Vector3(center, 25000, z), new THREE.Vector3(0, -1, 0)).intersectObject(fascia);
      assert.equal(hits.length, 0, "不能恢复跨过屋面的官帽后天沟");
    }
    const underside = new THREE.Box3().setFromObject(roof.getObjectByName("悬浮官帽封闭檐底")!).min.y;
    if (pitch === 4.5) {
      const expected = apronFasciaBottom(h.eave, 0);
      assert.ok(Math.abs(underside - expected) < 60, "封闭檐底贴在三眼皮下沿");
      assert.ok(eyelidStackHeight() === 350, "三眼皮总高固定 350mm");
      assert.ok(h.eave - m.eave > 50, "帽檐相对正屋檐口仍留柱头净空");
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
  assert.ok(floatingBox.max.y > joinedBox.max.y + 200, "悬浮官帽柱应明显高于原有官帽柱");
  assert.ok(joinedPier.getObjectByName("官帽柱正面装饰"), "原有官帽柱有正面装饰");
  assert.ok(floatingPier.getObjectByName("官帽柱正面装饰"), "悬浮官帽柱共用同一正面装饰");
  const h = floatingHatLayout(4.5);
  assert.ok(Math.abs(floatingBox.max.y - (h.eave - eyelidStackHeight())) < .1, "悬浮柱顶贴悬浮檐底");
  const decorTop = fasciaBottomY(h.eave, 0) - 100;
  const decor = floatingPier.getObjectByName("官帽柱正面装饰")!;
  const decorBox = new THREE.Box3().setFromObject(decor);
  assert.ok(Math.abs(decorBox.max.y - decorTop) < 80, "装饰上沿在悬浮下沿线底以下约 10 cm");
});

test("露台折线瓦檐的内外转角单层相接，柱脚处留精确切口", () => {
  const e = frontElevation, west = e.sideTerraces[0].x, east = e.sideTerraces[1].x + e.sideTerraces[1].w;
  const cw = site.portico.x, ce = cw + site.portico.w, v = site.secondFrontEave;
  const inner: Point[] = [[west,e.terraceBack],[west,e.terraceFront],[cw,e.terraceFront],[cw,e.centerFront],[ce,e.centerFront],[ce,e.terraceFront],[east,e.terraceFront],[east,e.terraceBack]];
  const outer: Point[] = [[west-v,e.terraceBack],[west-v,e.terraceFront-v],[cw-v,e.terraceFront-v],[cw-v,e.centerFront-v],[ce+v,e.centerFront-v],[ce+v,e.terraceFront-v],[east+v,e.terraceFront-v],[east+v,e.terraceBack]];
  const holes: Point[][] = e.balustradePosts.map(p => [[p.x-340,p.z-340],[p.x+340,p.z-340],[p.x+340,p.z+340],[p.x-340,p.z+340]]);
  const ribbon = [...outer, ...inner.slice().reverse()], group = new THREE.Group();
  tiledApron(group, inner, outer, 7700, e.tiledEaveDrop, mat, holes);
  // 无天沟挑檐的瓦覆盖完整出挑，仅在柱脚处留切口。
  let tileSamples = 0;
  for (let x = west - v + 31; x < east + v; x += 157) for (let z = e.centerFront - v + 47; z < e.terraceBack; z += 137) {
    const inOld = contains([x, z], ribbon) && !holes.some(h => contains([x, z], h));
    if (!inOld) {
      assert.equal(topHits(group, x, z).length, 0, `柱脚／域外不应有瓦 @ ${x},${z}`);
      continue;
    }
    tileSamples++;
    assert.equal(topHits(group, x, z).length, 1, `瓦檐重复、漏缝或穿柱 @ ${x},${z}`);
  }
  assert.ok(tileSamples > 300, "实际探测坡瓦覆盖面积，不能因瓦带坍缩为零而空跑通过");
});

test("陡坡、缓坡的筒瓦整个圆截面都收在本坡范围内，不穿过官帽交线", () => {
  const m = mainRoofFootprint(), center = site.portico.x + site.portico.w / 2;
  for (const pitch of [1,10]) {
    const eave = m.eave + roofTileEaveLift(), rise = roofPitch(pitch).mainRise;
    const main = hipRoofSurfaces(m.x+inset,m.z+inset,m.w-2*inset,m.d-2*inset,eave,rise);
    const h = joinedHatLayout(pitch);
    const hat = hatRoofSurfaces(center, h.z, h.w, h.joinZ, eave, h.peak, 1, h.ridgeFront);
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
// 距真实屋面边界90mm以上的瓦垄，不得因同坡面被分片而中途消失。
test("两种官帽裁切后同坡瓦垄连续，人工分片线两侧没有漏铺或重复筒瓦", () => {
  const m = mainRoofFootprint(), center = site.portico.x + site.portico.w / 2;
  for (const style of ["joined", "floating"] as const) for (const pitch of [1, 4.5, 10]) {
    const eave = m.eave + roofTileEaveLift(), rise = roofPitch(pitch).mainRise;
    const main = hipRoofSurfaces(m.x + inset, m.z + inset, m.w - 2 * inset, m.d - 2 * inset, eave, rise);
    const h = style === "joined" ? joinedHatLayout(pitch) : floatingHatLayout(pitch);
    const hat = hatRoofSurfaces(center, h.z, h.w, h.joinZ, h.eave + roofTileEaveLift(), h.peak, 1, h.ridgeFront);
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
        const samePlane = faces.filter(face => face.points.every(p => Math.abs(p.clone().sub(source.points[0]).dot(normal)) < 1e-4));
        if (!samePlane.length) continue;
        const polygons: Point[][] = samePlane.map(face => face.points.map(p => [p.x, p.z]));
        const across = source.across, down: Point = [-across[1], across[0]];
        const project = (x: number, z: number, axis: Point) => x * axis[0] + z * axis[1];
        const originU = project(...source.origin, across), originV = project(...source.origin, down);
        const us = polygons.flat().map(p => project(...p, across)), vs = polygons.flat().map(p => project(...p, down));
        const runs = new Map<number, [number, number][]>();
        for (const ends of segments) {
          const points = ends.map(p => p.clone().addScaledVector(normal, -22));
          if (!points.every(p => Math.abs(p.clone().sub(source.points[0]).dot(normal)) < 0.01)) continue;
          const k = Math.round((project(points[0].x, points[0].z, across) - originU) / 180);
          const span = points.map(p => project(p.x, p.z, down)).sort((a, b) => a - b) as [number, number];
          if (!runs.has(k)) runs.set(k, []);
          runs.get(k)!.push(span);
        }
        for (let k = Math.ceil((Math.min(...us) - originU) / 180); k <= Math.floor((Math.max(...us) - originU) / 180); k++) {
          const u = originU + k * 180;
          for (let v = Math.min(...vs) + 97; v < Math.max(...vs); v += 137) {
            const x = across[0] * u + down[0] * v, z = across[1] * u + down[1] * v;
            const interior = Array.from({ length: 16 }, (_, i) => {
              const angle = i * Math.PI / 8;
              return polygons.some(polygon => contains([x + 90 * Math.cos(angle), z + 90 * Math.sin(angle)], polygon));
            }).every(Boolean);
            if (!interior || Math.abs((v - originV) / 260 - Math.round((v - originV) / 260)) < 0.02) continue;
            const covering = (runs.get(k) ?? []).filter(([lo, hi]) => v >= lo - 0.01 && v <= hi + 0.01);
            assert.equal(covering.length, 1, `${style}/${pitch}分水 owner${owner} 的完整坡面漏铺或重复 @ ${x.toFixed(0)},${z.toFixed(0)}`);
          }
        }
      }
    }
  }
});

test("天沟槽底找坡只抬厘米级，不会把本地顶面写成屋面世界标高", () => {
  const group = new THREE.Group();
  gutteredRoof(group, 0, 0, 8000, 10000, 10500, 1200, mat);
  group.updateMatrixWorld(true);
  const beds: THREE.Object3D[] = [];
  group.traverse((o) => { if (o.name === "天沟槽底") beds.push(o); });
  assert.ok(beds.length > 0);
  for (const bed of beds) {
    const local = new THREE.Box3().setFromObject(bed);
    // 世界高度应在屋面附近，厚度／找坡合计远小于 1000，绝不能出现整层楼高的灰盒子。
    assert.ok(local.max.y - local.min.y < 250, `槽底竖直包络过大：${(local.max.y - local.min.y).toFixed(1)}`);
    assert.ok(local.max.y < 11200 && local.min.y > 10200, `槽底世界高度异常：${local.min.y.toFixed(0)}–${local.max.y.toFixed(0)}`);
  }
});

test("梁托中心按面宽／拐角间距排布，两端内收半个拐角距", () => {
  const centers = corbelCentersOnEdge(13500);
  assert.ok(centers.length >= 2);
  assert.ok(Math.abs(centers[0] - eaveTrimDesign.corbelCornerSpacing / 2) < 1e-6);
  assert.ok(Math.abs(centers.at(-1)! - (13500 - eaveTrimDesign.corbelCornerSpacing / 2)) < 1e-6);
  if (centers.length > 2) {
    const step = centers[1] - centers[0];
    assert.ok(Math.abs(step - eaveTrimDesign.corbelSpacing) < 150, "中距应接近默认 700mm");
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
    assert.ok(Math.abs(o - site.thirdEave) < 10, `${face} 出檐应为 ${site.thirdEave}`);
  }
  const expect = eaveTrimDesign.corbelLength;
  const corbels: THREE.Object3D[] = [];
  roof.traverse((o) => { if (o.name === "梁托") corbels.push(o); });
  assert.ok(corbels.length > 10, "主楼四周应有梁托");
  const { frontElevation } = await import("../src/data");
  const under = hatSupportInset();
  const hat = joinedHatLayout();
  const hatWest = hat.x + under;
  const hatEast = hat.x + hat.w - under;
  const hatFrontFace = frontElevation.hatFront + under;
  // 官帽前／侧梁托挂在檐下内侧，不要求贴退台墙皮；其余仍须贴墙。
  for (const c of corbels) {
    const b = new THREE.Box3().setFromObject(c);
    const back = new THREE.Vector3(0, 0, 0).applyMatrix4(c.matrixWorld);
    const nearWall = Math.min(
      Math.abs(back.x - wall.x0), Math.abs(back.x - wall.x1),
      Math.abs(back.z - wall.z0), Math.abs(back.z - wall.z1),
    );
    const nearHatFace = Math.min(
      Math.abs(back.z - hatFrontFace), Math.abs(back.x - hatWest), Math.abs(back.x - hatEast),
    );
    assert.ok(nearWall < 20 || nearHatFace < 50, `梁托背面离墙 ${nearWall.toFixed(1)} mm、离官帽檐 ${nearHatFace.toFixed(1)} mm`);
    const geometry = (c as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    const out = size.x, along = size.z, spanY = size.y;
    assert.ok(Math.abs(out - expect) < 1e-3, `出挑应为 ${expect.toFixed(0)}，得 ${out.toFixed(1)}`);
    assert.ok(Math.abs(along - eaveTrimDesign.corbelWidth) < 1e-3, `厚度应为160mm，得 ${along.toFixed(1)}`);
    assert.ok(Math.abs(spanY - 200) < 1e-3, `高度应为200mm，得 ${spanY.toFixed(1)}`);
  }
  annex.updateMatrixWorld(true);
  let annexCorbelCount = 0;
  annex.traverse((o) => {
    if (o.name !== "梁托") return;
    annexCorbelCount++;
    const geometry = (o as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const span = geometry.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(Math.abs(span.x - 500) < 1e-3, "辅楼梁托同样长500mm，不随较短出檐缩小");
    assert.ok(Math.abs(span.z - 160) < 1e-3, "辅楼梁托宽160mm");
    assert.ok(Math.abs(span.y - 200) < 1e-3, "辅楼梁托高200mm");
  });
  assert.ok(annexCorbelCount > 10, "辅楼四周应有梁托");
  // 辅楼三眼皮：最上层＝出挑、最下层＝出挑−200，与主楼同一台阶。
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
  assert.ok(Math.abs(layerOverhangs[0] - site.thirdEave) < 10, `最上层出挑 ${layerOverhangs[0]}`);
  assert.ok(Math.abs(layerOverhangs[1] - (site.thirdEave - 100)) < 10, `中层出挑 ${layerOverhangs[1]}`);
  assert.ok(Math.abs(layerOverhangs[2] - (site.thirdEave - 200)) < 10, `最下层出挑 ${layerOverhangs[2]}`);
  assert.ok(layerOverhangs[2] - eaveTrimDesign.corbelLength > 90, "梁托端头应比最下层短约100mm");
});

test("梁托侧视包络为落款 500×200，沿墙挤出 160", async () => {
  const { corbelProfileShape } = await import("../src/facade-details");
  const L = eaveTrimDesign.corbelLength;
  const H = eaveTrimDesign.corbelHeight;
  const W = eaveTrimDesign.corbelWidth;
  assert.equal(L, 500);
  assert.equal(H, 200);
  assert.equal(W, 160);
  const shape = corbelProfileShape(L, H);
  const pts = shape.getPoints(64);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  assert.ok(Math.min(...xs) > -1e-3 && Math.max(...xs) < L + 1e-3, "出挑落在 0–500");
  assert.ok(Math.min(...ys) > -1e-3 && Math.max(...ys) < H + 1e-3, "高度落在 0–200");
  assert.ok(Math.abs(Math.max(...xs) - L) < 1e-3, "端头顶到设计长度");
  assert.ok(Math.abs(Math.max(...ys) - H) < 1e-3, "顶面到设计高度");
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
    assert.ok(Math.abs(undersideAt(x) - expected) < 4, `图中x=${px}处应贴合原图轮廓（4mm内）`);
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
    new THREE.Vector3(cornerX, 12000, cornerZ),
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
  const fasciaBot = fasciaBottomY(10500, 0);
  assert.ok(Math.abs(maxHead - (fasciaBot - openingBelowFasciaClearance - floors[2].y)) < 1e-6);
  for (const wall of facades(2)) {
    for (const o of wall.openings) {
      assert.ok(
        o.sill + o.h <= maxHead + 1e-6,
        `洞口顶 ${ (o.sill + o.h).toFixed(1) } 不得超过 ${maxHead.toFixed(1)}`,
      );
    }
  }
});

test("三眼皮上下连续封闭，线脚背面接到墙体范围", () => {
  const wall = { x: 800, z: 800, w: 4400, d: 8400 };
  const group = new THREE.Group();
  gutteredRoof(group, 0, 0, 6000, 10000, 3600, 1100, mat, undefined, wall);
  const eyelid = group.getObjectByName("三眼皮檐口")!;
  group.updateMatrixWorld(true);
  // 三眼皮自板顶 3600 往下共 350；在上下层之间水平探入应封闭。
  for (let y = 3580; y > 3280; y -= 40) {
    const ray = new THREE.Raycaster(new THREE.Vector3(3130, y, -1000), new THREE.Vector3(0, 0, 1));
    const hits = ray.intersectObject(eyelid, true);
    assert.ok(hits.length > 0 && hits[0].point.z < 250, `檐口在 y=${y.toFixed(0)} 透空`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(3130, 4000, wall.z - 40), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(eyelid, true).length > 0, "檐板背部要盖到墙边，不留悬空带");
});

test("非整数模数的回纹仍左右等距，所有装饰顶点关于中线对称", () => {
  for (const width of [560, 2100, 3460, 3600]) {
    const group = new THREE.Group();
    meander(group, -width / 2, 0, 0, width, mat);
    group.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const p = object.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld));
    });
    const key = (x: number, y: number, z: number) => [x,y,z].map(n => Math.round(n * 100)).join(":");
    const coordinates = new Set(points.map(p => key(p.x,p.y,p.z)));
    for (const p of points) assert.ok(coordinates.has(key(-p.x,p.y,p.z)), `${width}mm 回纹在${p.x}处不对称`);
  }
});

test("窗玻璃与四边框槽相接，框内边缘不再透空", () => {
  const group = new THREE.Group();
  wallWithOpenings(group, [0,0], [4000,0], 0, 3000, [{at:2000,w:2000,sill:500,h:2000}], mat);
  group.updateMatrixWorld(true);
  for (const [x,y] of [[1065,1200],[2935,1200],[1400,565],[1400,2435]]) {
    const hits = new THREE.Raycaster(new THREE.Vector3(x,y,-1000), new THREE.Vector3(0,0,1)).intersectObject(group, true);
    assert.ok(hits.some(hit => [mat.glass, mat.dark].includes((hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial)), `窗框内沿漏空 @ ${x},${y}`);
  }
});

test("两种官帽梁托都有实体背梁，端头收在最下层檐板内，阴角不互撞", () => {
  for (const style of ["joined", "floating"] as const) for (const pitch of [1, 4.5, 10]) {
    const roof = new THREE.Group();
    attachRoofs(roof, new THREE.Group(), mat, pitch, style);
    roof.updateMatrixWorld(true);
    const corbels: THREE.Mesh[] = [], lids: THREE.Object3D[] = [];
    roof.traverse(o => {
      if (o.name === "梁托") corbels.push(o as THREE.Mesh);
      if (o.name === "三眼皮檐口") lids.push(o);
    });
    const support = roof.getObjectByName("官帽承托构件")!;
    const beam = support.getObjectByName("官帽连续承托梁")!;
    let backed = 0;
    support.traverse(o => {
      if (o.name !== "梁托") return;
      const start = new THREE.Vector3(12, eaveTrimDesign.corbelHeight * .7, 0).applyMatrix4(o.matrixWorld);
      const direction = new THREE.Vector3(-1, 0, 0).transformDirection(o.matrixWorld);
      const hits = new THREE.Raycaster(start, direction).intersectObject(beam);
      assert.ok(hits.length && hits[0].distance < 15, `${style}/${pitch} 梁托背面应贴住实体梁`);
      backed++;
    });
    assert.ok(backed >= 3, `${style}/${pitch} 官帽正面应有实际梁托`);
    for (const c of corbels) {
      const tip = new THREE.Vector3(eaveTrimDesign.corbelLength - 5, eaveTrimDesign.corbelHeight - 1, 0).applyMatrix4(c.matrixWorld);
      assert.ok(new THREE.Raycaster(tip, new THREE.Vector3(0, 1, 0)).intersectObjects(lids, true).length,
        `${style}/${pitch} 梁托不能伸出最下层檐板`);
    }
    const boxes = corbels.map(o => new THREE.Box3().setFromObject(o));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const overlap = boxes[a].clone().intersect(boxes[b]).getSize(new THREE.Vector3());
      assert.ok(overlap.x * overlap.y * overlap.z < 1, `${style}/${pitch} 第${a}/${b}件梁托在转角相撞`);
    }
    support.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) for (let axis = 0; axis < 3; axis++)
        assert.ok(Number.isFinite(p.getComponent(i, axis)), `${style}/${pitch} 承托构件不能有无效顶点`);
      const bounds = new THREE.Box3().setFromObject(o);
      assert.ok(bounds.min.z >= frontElevation.hatFront - 25, `${style}/${pitch} 低坡收口不能反折到官帽前方`);
    });
  }
});

test("三楼飘檐七段都有实际坡瓦，阴角梁托不相撞，下沿线端头不外甩", async () => {
  const { buildVilla } = await import("../src/architecture");
  const apron = buildVilla(mat, false).levels[2].getObjectByName("三楼栏杆下飘檐")!;
  const e = frontElevation;
  const west = e.sideTerraces[0].x, east = e.sideTerraces[1].x + e.sideTerraces[1].w;
  const cw = site.portico.x, ce = cw + site.portico.w;
  const samples: Point[] = [
    [west - 250, (e.terraceFront + e.terraceBack) / 2],
    [(west + cw) / 2, e.terraceFront - 250],
    [cw - 250, (e.terraceFront + e.centerFront) / 2],
    [(cw + ce) / 2, e.centerFront - 250],
    [ce + 250, (e.terraceFront + e.centerFront) / 2],
    [(ce + east) / 2, e.terraceFront - 250],
    [east + 250, (e.terraceFront + e.terraceBack) / 2],
  ];
  for (const [x, z] of samples) assert.equal(topHits(apron, x, z).length, 1, `坡瓦应覆盖 ${x},${z}`);
  const corbels: THREE.Box3[] = [];
  apron.traverse(o => { if (o.name === "梁托") corbels.push(new THREE.Box3().setFromObject(o)); });
  for (let a = 0; a < corbels.length; a++) for (let b = a + 1; b < corbels.length; b++) {
    const overlap = corbels[a].clone().intersect(corbels[b]).getSize(new THREE.Vector3());
    assert.ok(overlap.x * overlap.y * overlap.z < 1, `飘檐第${a}/${b}件梁托相撞`);
  }
  const fascia = apron.getObjectByName("连续转角下沿线")!;
  assert.ok(new THREE.Box3().setFromObject(fascia).max.z <= e.terraceBack + 1, "下沿线开口端应停在靠墙收口线");
  assert.ok(apron.getObjectByName("无天沟连续挑檐板"));
  apron.traverse(o => {
    if (!o.name.startsWith("无天沟")) assert.doesNotMatch(o.name, /天沟|三眼皮/, "二楼挑檐不得含天沟或屋顶三眼皮");
  });
});

test("无天沟挑檐瓦盖至外缘、檐底封闭，梁托顶面贴住薄檐板", () => {
  const group = new THREE.Group();
  tiledApron(group, [[0, 0], [4000, 0]], [[0, -800], [4000, -800]], 7700, 380, mat);
  group.updateMatrixWorld(true);
  const deck = group.getObjectByName("无天沟连续挑檐板")!;
  const edge = topHits(group, 2000, -790)[0], inside = topHits(group, 2000, -20)[0];
  assert.ok(edge && inside && inside.point.y > edge.point.y + 300, "坡瓦须铺到檐边，并朝外降低");
  for (const z of [-790, -500, -20]) {
    const hits = new THREE.Raycaster(new THREE.Vector3(2000, 6500, z), new THREE.Vector3(0, 1, 0)).intersectObject(deck, true);
    assert.ok(hits.length && Math.abs(hits[0].point.y - 7150) < 1, "檐底应是封闭水平板");
  }
  let corbels = 0;
  group.traverse(o => {
    if (o.name !== "梁托") return;
    corbels++;
    const tip = new THREE.Vector3(eaveTrimDesign.corbelLength - 5, eaveTrimDesign.corbelHeight - 1, 0).applyMatrix4(o.matrixWorld);
    const hits = new THREE.Raycaster(tip, new THREE.Vector3(0, 1, 0)).intersectObject(deck, true);
    assert.ok(hits.length && hits[0].distance < 2, "梁托端头须贴住檐底，不悬空");
  });
  assert.ok(corbels >= 3);
  assert.ok(Math.abs(edge.point.y - new THREE.Box3().setFromObject(deck).min.y - 170) < 8,
    "瓦下仅露薄檐板，不能重新出现厚重沟槽挡边");
});

test("门厅团花及柱身垂花按实际尺寸倒角，不扩成穿出横梁和柱面的大片", () => {
  const root = new THREE.Group();
  const beam = referencePorticoBeam(root, 0, 0, 6750, 4600, 800, mat);
  referencePorticoColumn(root, -2300, 400, 430, 6320, 800, 800, mat);
  root.updateMatrixWorld(true);
  const flower = beam.getObjectByName("横梁中央八瓣团花浮雕")!;
  const bounds = new THREE.Box3().setFromObject(flower), size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x < 330 && size.y < 330, "直径312的团花不能因倒角缩放膨胀成大八角板");
  assert.ok(bounds.min.y > 6750 - 670 && bounds.max.y < 6750, "团花应完整落在横梁饰面内");
  assert.equal(flower.children.filter(o => o.name === "团花花瓣").length, 8);
  let pendants = 0;
  root.traverse(o => {
    if (o.name !== "柱身上端卷草垂花浮雕") return;
    pendants++;
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.z) < 300 && size.y < 510, "柱身垂花应保持约263×470，不扩张到柱头或柱侧");
  });
  assert.equal(pendants, 4);
  for (const name of ["门厅柱间横梁实体", "门厅横梁上沿线"]) {
    const bounds = new THREE.Box3().setFromObject(beam.getObjectByName(name)!);
    assert.ok(bounds.min.x >= -1908.1 && bounds.max.x <= 1908.1, "横梁应止于柱间净跨，仅留8毫米嵌接");
  }
});

test("门厅柱帽、梁托及下沿线不穿插，柱顶与横梁承托标高一致", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
  const section = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
  const columns: THREE.Object3D[] = [], corbels: THREE.Object3D[] = [];
  villa.group.traverse(o => { if (o.name === "参考图通高门厅雕花柱") columns.push(o); });
  apron.traverse(o => { if (o.name === "梁托") corbels.push(o); });
  assert.equal(columns.length, 2);
  const fascia = new THREE.Box3().setFromObject(apron.getObjectByName("连续转角下沿线")!);
  const beam = villa.group.getObjectByName("参考图门厅雕花横梁")!;
  assert.equal(beam.position.y, fascia.min.y, "雕花横梁顶与檐下承托标高应一致");
  for (const column of columns) {
    const bounds = new THREE.Box3().setFromObject(column);
    assert.ok(Math.abs(bounds.max.y - fascia.min.y) < .1, "柱帽顶须接下沿线底，不能穿进檐下排布区");
    for (const corbel of corbels) {
      const overlap = bounds.clone().intersect(new THREE.Box3().setFromObject(corbel)).getSize(new THREE.Vector3());
      assert.ok(overlap.x * overlap.y * overlap.z < 1, "梁托不能穿入门厅柱帽");
    }
  }
  const support = apron.getObjectByName("挑檐连续承托梁")!;
  assert.ok(support, "梁托背面应有连续实体承托梁，不能只剩孤立下沿线");
  for (const corbel of corbels) {
    const point = new THREE.Vector3(12, eaveTrimDesign.corbelHeight * .5, 0).applyMatrix4(corbel.matrixWorld);
    const direction = new THREE.Vector3(-1, 0, 0).transformDirection(corbel.matrixWorld);
    const hits = new THREE.Raycaster(point, direction).intersectObject(support);
    assert.ok(hits.length && hits[0].distance < 16, "梁托背面要贴连续梁，不得悬空");
  }
});

test("露台短柱脚处的檐底由实体承台封闭，不留贯穿方洞", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
  const section = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
  for (const [i, post] of frontElevation.balustradePosts.slice(1, 3).entries()) {
    const x = post.x + (i === 0 ? 100 : -100), z = frontElevation.centerFront - 20;
    const hits = new THREE.Raycaster(new THREE.Vector3(x, section.fasciaBottomY - 1, z), new THREE.Vector3(0, 1, 0)).intersectObject(apron, true);
    assert.ok(hits.length && hits[0].point.y <= section.soffitY + 1, "柱脚附近仰视须有封闭承台或檐底，不能从方洞透到上方");
  }
});

test("四根露台短柱的整块柱座落在实体承台上，不只以柱心或一条挡墙承托", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const posts = villa.levels[2].getObjectByName("四根露台短柱")!.children;
  const seats = villa.levels[2].getObjectByName("四处柱位实体承台")!;
  for (const post of posts) {
    const foot = post.children.filter(o => o instanceof THREE.Mesh)
      .map(o => new THREE.Box3().setFromObject(o)).sort((a, b) => a.min.y - b.min.y)[0];
    assert.ok(Math.abs(foot.min.y - floors[2].y) < .1, "柱座须延伸到露台标高，不能停在坡瓦上方");
    assert.ok(seats && seats.children.length === 4, "四处柱位均须有实际承台");
    for (const x of [foot.min.x + 4, (foot.min.x + foot.max.x) / 2, foot.max.x - 4])
      for (const z of [foot.min.z + 4, (foot.min.z + foot.max.z) / 2, foot.max.z - 4]) {
        const hits = new THREE.Raycaster(new THREE.Vector3(x, foot.min.y + 10, z), new THREE.Vector3(0, -1, 0))
          .intersectObject(seats, true);
        assert.ok(hits.length && Math.abs(hits[0].point.y - foot.min.y) < .1,
          `柱座边角必须有贴合的实体承台 @ ${x},${z}`);
      }
  }
});

test("柱帽、承台收边、柱颈及短柱座逐层相接，线脚和梁托在柱位收口", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
  const seats = apron.getObjectByName("四处柱位实体承台")!;
  assert.ok(seats, "必须有柱位承托节点");
  const columns: THREE.Object3D[] = [];
  villa.portico.traverse(o => { if (o.name === "参考图通高门厅雕花柱" ||
    o.name === "包角柱" && o.position.z < site.main.z) columns.push(o); });
  assert.equal(columns.length, 4);
  const lowerNecks = villa.portico.children.filter(o => o.name === "包角柱退进承托柱颈");
  assert.equal(lowerNecks.length, 2);
  for (const node of seats.children) {
    const neck = new THREE.Box3().setFromObject(node.getObjectByName("柱帽上实体柱颈")!);
    const pad = new THREE.Box3().setFromObject(node.getObjectByName("承台整圈收边")!);
    assert.ok(Math.abs(pad.max.y - neck.min.y) < .1 && Math.abs(neck.max.y - floors[2].y) < .1);
    const center = pad.getCenter(new THREE.Vector3());
    const column = columns.reduce((a, b) => Math.abs(a.position.x - center.x) < Math.abs(b.position.x - center.x) ? a : b);
    const columnTop = new THREE.Box3().setFromObject(column).max.y;
    if (column.name === "包角柱") {
      const lower = lowerNecks.find(o => o.position.x === column.position.x)!;
      const lowerBounds = new THREE.Box3().setFromObject(lower);
      assert.ok(Math.abs(columnTop - lowerBounds.min.y) < .1 && Math.abs(lowerBounds.max.y - pad.min.y) < .1,
        "下收的柱冠必须经实体柱颈接到承台");
    } else assert.ok(Math.abs(columnTop - pad.min.y) < .1, "门厅柱帽应接触承台");
    const cutters = [apron.getObjectByName("连续转角下沿线")!, apron.getObjectByName("挑檐连续承托梁")!];
    apron.traverse(o => { if (o.name === "梁托") cutters.push(o); });
    for (const obj of cutters) obj.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const overlap = neck.clone().intersect(new THREE.Box3().setFromObject(o)).getSize(new THREE.Vector3());
      assert.ok(overlap.x * overlap.y * overlap.z < 1, "线脚、承托梁及梁托不得穿过实体柱颈");
    });
  }
});

test("露台玻璃栏杆端头止于柱侧，金属立框落到挡墙顶，不穿过四根短柱", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const columns: THREE.Box3[] = [];
  const wall = villa.levels[2].getObjectByName("三楼屋檐内50厘米挡墙")!;
  villa.levels[2].getObjectByName("四根露台短柱")!.traverse(o => {
    if (o instanceof THREE.Mesh) columns.push(new THREE.Box3().setFromObject(o));
  });
  let rails = 0;
  villa.levels[2].traverse(o => {
    if (o.name !== "三楼通透玻璃栏板与细金属框") return;
    rails++;
    const bottom = new THREE.Box3().setFromObject(o).min.y;
    assert.ok(Math.abs(bottom - floors[2].y - frontElevation.eaveParapet) < .1,
      "金属立框应落在挡墙顶面，不得留下20毫米悬空缝");
    o.traverse(part => {
      if (!(part instanceof THREE.Mesh)) return;
      const bounds = new THREE.Box3().setFromObject(part);
      if (Math.abs(bounds.min.y - bottom) < .1 && bounds.max.y - bottom > 500) {
        const center = bounds.getCenter(new THREE.Vector3());
        for (const [x, z] of [[center.x, center.z], [bounds.min.x + .1, bounds.min.z + .1],
          [bounds.min.x + .1, bounds.max.z - .1], [bounds.max.x - .1, bounds.min.z + .1],
          [bounds.max.x - .1, bounds.max.z - .1]]) {
          const hit = new THREE.Raycaster(new THREE.Vector3(x, bottom + 1, z),
            new THREE.Vector3(0, -1, 0)).intersectObject(wall, true)[0];
          assert.ok(hit && hit.distance < 1.1, `立框底面须完整落在挡墙实体上 @ ${x},${z}`);
        }
      }
      for (const column of columns) {
        const overlap = bounds.clone().intersect(column).getSize(new THREE.Vector3());
        assert.ok(overlap.x * overlap.y * overlap.z < 1,
          "栏板、扶手和金属立框不得穿入柱座、柱身或柱帽");
      }
    });
  });
  assert.equal(rails, 7);
});

test("一二层檐下各净段等分、门厅梁托镜像，阴阳角不设斜向梁托", async () => {
  const { buildVilla } = await import("../src/architecture");
  const { resetVillaParams } = await import("../src/villa-params");
  resetVillaParams();
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const apron = villa.levels[2].getObjectByName("三楼栏杆下飘檐")!;
  const corbels: THREE.Object3D[] = [], annexCorbels: THREE.Object3D[] = [];
  apron.traverse(o => { if (o.name === "梁托") corbels.push(o); });
  villa.annexRoof.traverse(o => { if (o.name === "梁托") annexCorbels.push(o); });
  const diagonal = (o: THREE.Object3D) => Math.abs(Math.sin(2 * o.rotation.y)) > .9;
  assert.equal(annexCorbels.filter(diagonal).length, 0, "辅楼四个阳角不设梁托");
  assert.equal(corbels.filter(diagonal).length, 0, "门厅阴角及柱位不塞斜向梁托");
  const cx = site.portico.x + site.portico.w / 2;
  // 两翼已改为4600/4500，不再要求整栋关于门厅中轴对称；中央门厅仍须镜像。
  const middleCorbels = corbels.filter(c => c.position.x >= site.portico.x && c.position.x <= site.portico.x + site.portico.w);
  assert.ok(middleCorbels.length >= 4);
  for (const c of middleCorbels) assert.ok(middleCorbels.some(other =>
    Math.abs(c.position.x + other.position.x - 2 * cx) < .1 && Math.abs(c.position.z - other.position.z) < .1),
    "中央门厅梁托必须关于门厅中轴镜像");
  const edgeGroups = new Map<string, THREE.Object3D[]>();
  for (const c of [...corbels, ...annexCorbels].filter(c => !diagonal(c))) {
    const alongX = Math.abs(Math.sin(c.rotation.y)) > .9;
    const wing = alongX && Math.abs(c.position.z - frontElevation.terraceFront - 8) < .1 ?
      (c.position.x < cx ? "west" : "east") : "";
    const key = `${c.position.y}/${alongX}/${alongX ? c.position.z : c.position.x}/${wing}`;
    const list = edgeGroups.get(key) ?? []; list.push(c); edgeGroups.set(key, list);
  }
  for (const list of edgeGroups.values()) {
    const alongX = Math.abs(Math.sin(list[0].rotation.y)) > .9;
    const positions = list.map(c => alongX ? c.position.x : c.position.z).sort((a, b) => a - b);
    const gaps = positions.slice(1).map((p, i) => p - positions[i]);
    if (gaps.length) {
      assert.ok(Math.max(...gaps) - Math.min(...gaps) < .1, "同一净段须重新均分，不能删掉撞柱梁托后留下跳档");
      assert.ok(Math.max(...gaps) < eaveTrimDesign.corbelSpacing * 1.2, "净段中距不能出现大空档");
    }
  }
  const west = frontElevation.balustradePosts[0];
  const front = corbels.filter(c => Math.abs(c.position.z - frontElevation.terraceFront - 8) < .1 && c.position.x < site.portico.x);
  const first = Math.min(...front.map(c => c.position.x));
  assert.ok(Math.abs(first - eaveTrimDesign.corbelWidth / 2 - (west.x + (west.w + 80) / 2) - 40) < .1,
    "第一件梁托按柱脚实体边缘排起，不能沿用删除后剩余的远端模块");
});

test("三楼正面窗侧不残留横槽，次要柱冠下收后仍经实体柱颈连续承托", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false);
  villa.group.updateMatrixWorld(true);
  const grooves = villa.levels[2].getObjectByName("水包砂凹槽")!;
  for (const part of grooves.children) {
    const b = new THREE.Box3().setFromObject(part), size = b.getSize(new THREE.Vector3());
    if (size.x > 160 && size.z < 20) assert.ok(b.min.z >= floors[2].front - 1,
      "删除三楼正面包角柱后，正面窗边不能残留独立横槽");
  }
  assert.ok(villa.levels[1].getObjectByName("水包砂凹槽")!.children.length > 0, "下层原有墙面分缝保留");
  const outer = villa.portico.children.filter(o => o.name === "包角柱" && o.position.z < site.main.z);
  const necks = villa.portico.children.filter(o => o.name === "包角柱退进承托柱颈");
  assert.equal(outer.length, 2); assert.equal(necks.length, 2);
  const top = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop).porticoTopY;
  for (const column of outer) {
    const b = new THREE.Box3().setFromObject(column);
    const neck = new THREE.Box3().setFromObject(necks.find(o => o.position.x === column.position.x)!);
    assert.ok(Math.abs(top - b.max.y - 180) < .1 && Math.abs(b.max.y - neck.min.y) < .1 && Math.abs(neck.max.y - top) < .1);
    assert.ok(neck.getSize(new THREE.Vector3()).x < b.getSize(new THREE.Vector3()).x, "承托柱颈应退进柱冠轮廓");
  }
});

test("三楼中央栏杆分格镜像、交会共用立框且玻璃不穿框，四短柱同高同轴", async () => {
  const { buildVilla } = await import("../src/architecture");
  const villa = buildVilla(mat, false); villa.group.updateMatrixWorld(true);
  const level = villa.levels[2], cx = site.portico.x + site.portico.w / 2;
  const panes: THREE.Box3[] = [], frames: THREE.Box3[] = [], rails: THREE.Box3[] = [];
  level.traverse(o => {
    if (o.name === "露台玻璃分格") panes.push(new THREE.Box3().setFromObject(o));
    if (o.name === "露台栏杆立框") frames.push(new THREE.Box3().setFromObject(o));
    if (o.name === "露台扶手") rails.push(new THREE.Box3().setFromObject(o));
  });
  assert.ok(panes.length >= 12 && frames.length >= 12);
  // 不等宽两翼各按自己的净跨分格，中央门厅与两条返段仍按同一中轴镜像。
  for (const list of [panes, frames, rails]) for (const b of list.filter(b =>
    b.min.x >= site.portico.x && b.max.x <= site.portico.x + site.portico.w)) {
    assert.ok(list.some(other => Math.abs(b.min.x + other.max.x - 2 * cx) < .1 &&
      Math.abs(b.max.x + other.min.x - 2 * cx) < .1 && Math.abs(b.min.z - other.min.z) < .1 &&
      Math.abs(b.max.z - other.max.z) < .1 && Math.abs(b.max.y - other.max.y) < .1), "栏杆实体须镜像对称");
  }
  for (const pane of panes) {
    const size = pane.getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.z) < 1400, "玻璃按一致的净跨尺度分格");
    for (const frame of frames) {
      const overlap = pane.clone().intersect(frame).getSize(new THREE.Vector3());
      assert.ok(overlap.x * overlap.y * overlap.z < 1, "转角玻璃不可穿过共用立框");
    }
  }
  for (let i = 0; i < rails.length; i++) for (let j = i + 1; j < rails.length; j++) {
    const overlap = rails[i].clone().intersect(rails[j]).getSize(new THREE.Vector3());
    assert.ok(overlap.x * overlap.y * overlap.z < 1, "T形扶手应端面相接，不得交叉重叠");
  }
  for (const x of [site.portico.x + 140, site.portico.x + site.portico.w - 140]) {
    const z = frontElevation.terraceFront + 140;
    assert.equal(frames.filter(b => Math.abs(b.getCenter(new THREE.Vector3()).x - x) < .1 &&
      Math.abs(b.getCenter(new THREE.Vector3()).z - z) < .1).length, 1, "交会轴线必须恰有一根共用立框");
  }
  for (const [i, post] of level.getObjectByName("四根露台短柱")!.children.entries()) {
    const bounds = new THREE.Box3().setFromObject(post);
    assert.ok(Math.abs(bounds.max.y - floors[2].y - frontElevation.eaveParapet - 800) < .1);
    assert.ok(Math.abs(post.position.x - frontElevation.balustradePosts[i].x) < .1, "短柱中心沿用下方柱位轴线");
  }
});

test("改屋顶天沟宽高及三眼皮下沿线间距，不改变二楼无天沟挑檐", async () => {
  const { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } = await import("../src/villa-params");
  const geometry = () => {
    const group = new THREE.Group();
    tiledApron(group, [[0, 0], [4000, 0]], [[0, -800], [4000, -800]], 7700, 380, mat);
    const shapes: unknown[] = [];
    group.traverse(o => { if (o instanceof THREE.Mesh) shapes.push([o.position.toArray(), o.rotation.toArray(),
      Array.from(o.geometry.getAttribute("position").array)]); });
    return shapes;
  };
  resetVillaParams();
  const before = geometry(), profile = frontApronSection(7700, 380);
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterClearWidth: 1000, gutterInnerDepth: 650,
      gutterClearDepth: 450, gutterTileGap: 200, gutterOuterTopWidth: 450, eyelidToFasciaGap: 500 });
    assert.deepEqual(geometry(), before);
    assert.deepEqual(frontApronSection(7700, 380), profile);
  } finally { resetVillaParams(); }
});

test("悬浮官帽开间下不残留正屋重复横檐，两翼檐口仍完整", () => {
  const roof = new THREE.Group();
  attachRoofs(roof, new THREE.Group(), mat, 4.5, "floating");
  roof.updateMatrixWorld(true);
  const m = mainRoofFootprint();
  const lids = roof.getObjectByName("正屋四坡")!.getObjectByName("三眼皮檐口")!;
  const center = site.portico.x + site.portico.w / 2;
  const cast = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, m.eave - 175, m.z - 1500),
    new THREE.Vector3(0, 0, 1)).intersectObject(lids, true);
  for (const x of [frontElevation.postXs[0] + frontElevation.dividerWidth / 2 + 20, center,
    frontElevation.postXs[1] - frontElevation.dividerWidth / 2 - 20])
    assert.ok(cast(x).every(h => h.point.z > m.z + 800), "柱间门窗及两端不能残留深色横檐端头");
  for (const x of [site.main.x + 1000, site.main.x + site.main.w - 1000]) {
    const wing = cast(x);
    assert.ok(wing.length && wing[0].point.z < m.z + 210, "左右两翼檐口应连续保留");
  }
});

test("官帽两侧下沿线与背梁、正屋横檐交接处只有一层可见底面", () => {
  for (const style of ["joined", "floating"] as const) {
    const roof = new THREE.Group();
    attachRoofs(roof, new THREE.Group(), mat, 4.5, style);
    roof.updateMatrixWorld(true);
    const support = roof.getObjectByName("官帽承托构件")!;
    const beam = new THREE.Box3().setFromObject(support.getObjectByName("官帽连续承托梁")!);
    const west = beam.min.x, east = beam.max.x;
    const points = [
      [west + 4, beam.min.z + 500], [east - 4, beam.min.z + 500],
      ...(style === "joined" ? [[west - 50, floors[2].front - 50], [east + 50, floors[2].front - 50]] : []),
    ];
    for (const [x, z] of points) {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, beam.min.y - 1000, z), new THREE.Vector3(0, 1, 0))
        .intersectObject(roof, true).filter(h => (h.face?.normal.y ?? 0) < -.99);
      assert.ok(hits.length, `${style}/${x}/${z} 檐底不能透空`);
      const first = hits[0];
      const coincident = new Set(hits.filter(h => Math.abs(h.distance - first.distance) < .1).map(h => h.object));
      assert.equal(coincident.size, 1, `${style}/${x}/${z} 重复底面会引起闪动`);
    }
  }
});
