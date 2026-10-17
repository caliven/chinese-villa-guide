import test from "node:test";
import assert from "node:assert/strict";
import { floors, site, courtyardArcAnchors, courtyardFront, annexFurniture, frontElevation } from "../src/data";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  LOCKED_SITE_WIDTH,
  resetVillaParams,
  validateVillaParams,
} from "../src/villa-params";
import { clonePublishedLayout, scaleLayoutDraftToEnvelope, envelopeFromSite } from "../src/layout-draft";
import { garageLayout } from "../src/garage-layout";
import { surroundings, terraceContours } from "../src/surroundings";
import { contourAt } from "../src/contours";

test("东墙锚定：西侧由其余面宽反推；过宽时校验失败", () => {
  const ok = validateVillaParams(DEFAULT_VILLA_PARAMS);
  assert.equal(ok.length, 0);
  // 主楼略增宽仍可由西侧吸收
  assert.equal(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14 }).length, 0);
  // 主楼过宽导致西侧≤0
  const badWide = validateVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 15 });
  assert.ok(badWide.some((i) => i.message.includes("西侧")));
  // 辅楼进深大于主楼（后墙齐平约束）
  const badDeep = validateVillaParams({ ...DEFAULT_VILLA_PARAMS, annexDepth: 11 });
  assert.ok(badDeep.some((i) => i.field === "annexDepth"));
});

test("改主楼面宽／进深时东墙与南墙不动，只动西墙与北墙", () => {
  resetVillaParams();
  const east0 = site.main.x + site.main.w;
  const south0 = site.main.z + site.main.d;
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14, mainDepth: 11 });
  assert.ok(Math.abs(site.main.x + site.main.w - east0) < 1e-9);
  assert.ok(Math.abs(site.main.z + site.main.d - south0) < 1e-9);
  assert.ok(site.main.x < 6.8 - 0.1);
  assert.ok(site.main.z < -0.4 - 0.1);
  // 辅楼后墙仍与主楼齐平，东墙贴子孙道西缘
  assert.ok(Math.abs(site.annex.z + site.annex.d - south0) < 1e-9);
  assert.ok(Math.abs(site.annex.x + site.annex.w + site.lane - site.main.x) < 1e-9);
  assert.ok(Math.abs(getVillaParams().westGap - site.annex.x) < 1e-9);
  assert.ok(Math.abs(getVillaParams().annexSetback - (11 - DEFAULT_VILLA_PARAMS.annexDepth)) < 1e-9);
  resetVillaParams();
});

test("合法改主楼进深后房间与家具同轴比例缩放，还原后回到默认", () => {
  const tea = () => floors[0].rooms.find((r) => r.id === "tea")!;
  const before = { ...tea(), furniture: floors[0].furniture.map((f) => ({ ...f })) };
  const sofa = floors[0].furniture.find((f) => f.kind === "sofa") ?? floors[0].furniture[0];
  assert.ok(sofa);
  const sofaBefore = { w: sofa.w, d: sofa.d, x: sofa.x, z: sofa.z };

  const next = { ...DEFAULT_VILLA_PARAMS, mainDepth: 11 };
  // 保持总宽：进深变不影响面宽分配
  const scale = applyVillaParams(next);
  assert.ok(Math.abs(scale.sz - 11 / 10) < 1e-9);
  assert.ok(Math.abs(scale.sx - 1) < 1e-9);
  assert.equal(site.main.d, 11);
  const after = tea();
  assert.ok(Math.abs(after.d - before.d * scale.sz) < 1e-6);
  assert.ok(Math.abs(after.w - before.w * scale.sx) < 1e-6);
  const sofaAfter = floors[0].furniture.find((f) => f.id === sofa.id) ?? floors[0].furniture[0];
  assert.ok(Math.abs(sofaAfter.w - sofaBefore.w * scale.sx) < 1e-6);
  assert.ok(Math.abs(sofaAfter.d - sofaBefore.d * scale.sz) < 1e-6);
  // 面积比 = sx×sz
  const areaRatio = (after.w * after.d) / (before.w * before.d);
  assert.ok(Math.abs(areaRatio - scale.sx * scale.sz) < 1e-6);

  resetVillaParams();
  assert.equal(site.main.d, DEFAULT_VILLA_PARAMS.mainDepth);
  assert.equal(site.main.w, DEFAULT_VILLA_PARAMS.mainWidth);
  const restored = tea();
  assert.ok(Math.abs(restored.w - before.w) < 1e-6);
  assert.ok(Math.abs(restored.d - before.d) < 1e-6);
});

test("院坪三点总进深随参数重写锚点", () => {
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    courtyardWestTotal: 12,
    courtyardMidTotal: 16,
    courtyardEastTotal: 20,
    courtyardMidFromEast: 11,
  });
  const [west, mid, east] = courtyardArcAnchors;
  assert.ok(Math.abs(west[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 12)) < 1e-9);
  assert.ok(Math.abs(mid[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 16)) < 1e-9);
  assert.ok(Math.abs(east[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 20)) < 1e-9);
  assert.ok(Math.abs(mid[0] - (LOCKED_SITE_WIDTH - 11)) < 1e-9);
  // 地库入口／sharedFront／邻居前坪须跟新东端外沿，不能停在旧 −8.6
  const eastFront = courtyardFront.at(-1)![1];
  assert.ok(Math.abs(garageLayout.entry.z - site.cut.z) < 1e-9);
  assert.ok(Math.abs(garageLayout.entry.z - eastFront) < 1e-6);
  assert.ok(Math.abs(surroundings.neighborYard.z - eastFront) < 1e-6);
  assert.ok(Math.abs(contourAt(terraceContours.sharedFront, site.width) - eastFront) < 0.05);
  assert.ok(Math.abs(contourAt(terraceContours.rearFirst, site.width / 2) - site.oldDepth) < 0.05);
  resetVillaParams();
  assert.ok(Math.abs(courtyardArcAnchors[0][1] - (DEFAULT_VILLA_PARAMS.oldDepth - DEFAULT_VILLA_PARAMS.courtyardWestTotal)) < 1e-9);
});

test("屋后预留等场地参数应用后保持用户值，不退回默认 1.2", () => {
  resetVillaParams();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1, oldDepth: 10.5 });
  assert.equal(site.rearGap, 1);
  assert.equal(site.oldDepth, 10.5);
  assert.equal(getVillaParams().rearGap, 1);
  assert.equal(getVillaParams().oldDepth, 10.5);
  // 再应用只改面宽分配中的无关项，预留应仍为 1
  applyVillaParams({ ...getVillaParams(), westGap: 0.9, eastGap: 0.6 });
  assert.equal(getVillaParams().rearGap, 1);
  resetVillaParams();
  assert.equal(getVillaParams().rearGap, DEFAULT_VILLA_PARAMS.rearGap);
});

test("减小屋后预留时主楼辅楼整体向南平移，后墙到梯田边等于预留", () => {
  resetVillaParams();
  const baseMainZ = site.main.z;
  const baseAnnexZ = site.annex.z;
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1 });
  const expectedMainZ = DEFAULT_VILLA_PARAMS.oldDepth - 1 - DEFAULT_VILLA_PARAMS.mainDepth;
  assert.ok(Math.abs(site.main.z - expectedMainZ) < 1e-9);
  assert.ok(site.main.z > baseMainZ);
  assert.ok(Math.abs(site.annex.z - (site.main.z + DEFAULT_VILLA_PARAMS.annexSetback)) < 1e-9);
  assert.ok(site.annex.z > baseAnnexZ);
  assert.ok(Math.abs(site.main.z + site.main.d + site.rearGap - site.oldDepth) < 1e-9);
  resetVillaParams();
  assert.ok(Math.abs(site.main.z - baseMainZ) < 1e-9);
});

test("屋后预留变化后通高玻璃与辅楼屋顶随楼体 Z 平移", async () => {
  const { buildVilla, annexRoofFootprint } = await import("../src/architecture");
  const THREE = await import("three");
  type Mats = import("../src/primitives").Mats;
  const mat = new Proxy({} as Mats, {
    get(target, key: keyof Mats) {
      return (target[key] ??= new THREE.MeshPhysicalMaterial() as never);
    },
  });
  resetVillaParams();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1 });
  // rearGap=1 → main.z = 10.8−1−10 = −0.2；相对默认 −0.4 南移 0.2
  assert.ok(Math.abs(site.main.z - (-0.2)) < 1e-9);
  const roof = annexRoofFootprint();
  // 辅楼四面与主楼同一 thirdEave。
  assert.ok(Math.abs(site.eave - site.thirdEave) < 1e-9);
  assert.ok(Math.abs(roof.z - (site.annex.z - site.thirdEave)) < 1e-9);
  assert.ok(Math.abs(roof.d - (site.annex.d + 2 * site.thirdEave)) < 1e-9);
  assert.ok(Math.abs(roof.w - (site.annex.w + 2 * site.thirdEave)) < 1e-9);
  const villa = buildVilla(mat, false);
  const curtain = villa.group.getObjectByName("挑空客厅一二层通高玻璃");
  assert.ok(curtain);
  let glassZ = Number.NaN;
  curtain!.traverse((o) => {
    if (o instanceof THREE.Mesh && Number.isNaN(glassZ)) glassZ = o.position.z;
  });
  assert.ok(Number.isFinite(glassZ));
  // 默认玻璃约 −0.835 → site.main.z + 0.165
  assert.ok(Math.abs(glassZ - (site.main.z + 0.165)) < 1e-6);
  resetVillaParams();
});

test("三楼短柱与门厅柱、包角柱同轴，改门厅参数后一起挪", () => {
  resetVillaParams();
  const e = frontElevation;
  const [west, midW, midE, east] = e.balustradePosts;
  assert.equal(midW.x, e.postXs[0]);
  assert.equal(midE.x, e.postXs[1]);
  assert.equal(midW.z, e.porticoColumnZ);
  assert.equal(midE.z, e.porticoColumnZ);
  assert.equal(midW.w, DEFAULT_VILLA_PARAMS.porticoColumnSize);
  const project = e.cornerProject, leg = e.cornerLeg;
  assert.ok(Math.abs(west.x - (e.cornerWestX - (project - leg) / 2)) < 1e-9);
  assert.ok(Math.abs(east.x - (e.cornerEastX + (project - leg) / 2)) < 1e-9);
  assert.ok(Math.abs(west.z - (site.main.z - 0.12 - project / 2)) < 1e-9);
  // 官帽柱／构造柱北皮贴一层前墙外皮。
  assert.ok(Math.abs(e.postZ - 0.25 - site.main.z) < 1e-9);

  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    porticoColumnWallGap: 2.1,
    porticoColumnSize: 0.9,
    porticoWidth: 5.0,
    // 总宽锁定：主楼仍 13.5，门厅面宽变不影响面宽合计
  });
  const e2 = frontElevation;
  const half = 0.45;
  assert.equal(e2.balustradePosts[1].x, site.portico.x + half);
  assert.equal(e2.balustradePosts[2].x, site.portico.x + site.portico.w - half);
  assert.equal(e2.balustradePosts[1].z, e2.porticoColumnZ);
  assert.equal(e2.balustradePosts[1].w, 0.9);
  assert.ok(Math.abs(e2.porticoColumnZ - (site.main.z - 2.1 - 0.45)) < 1e-9);
  assert.ok(Math.abs(e2.postZ - site.main.z - 0.25) < 1e-9);
  resetVillaParams();
});

test("布局草稿按外包络轴向缩放且不叠乘", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  assert.ok(draft.annexRooms.length || annexFurniture.length);
  const room0 = draft.floors[0].rooms[0];
  const w0 = room0.w;
  const target = envelopeFromSite();
  target.mainW = 14.5;
  // 总宽需配合：此处只测草稿缩放函数
  target.mainD = 10;
  const once = scaleLayoutDraftToEnvelope(draft, target);
  assert.ok(Math.abs(once.floors[0].rooms[0].w - w0 * (14.5 / 13.5)) < 1e-6);
  assert.match(once.note, /已随方案参数重算/);
  const twice = scaleLayoutDraftToEnvelope(once, target);
  assert.ok(Math.abs(twice.floors[0].rooms[0].w - once.floors[0].rooms[0].w) < 1e-9);
  resetVillaParams();
});
